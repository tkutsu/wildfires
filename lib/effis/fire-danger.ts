/**
 * Fire danger at a point, from the EFFIS Fire Weather Index.
 *
 * The FWI rates how readily a fire would start and spread given the weather:
 * temperature, humidity, wind and rain. EFFIS publishes it as an ECMWF
 * forecast running nine days out. There is no point-query API for it: the
 * `ecmwf.query` layer answers GetFeatureInfo with an empty feature, and the
 * EFFIS hotspot layers that carry richer fields stopped updating in 2021. What
 * the service does serve is the rendered map, so this asks for a single pixel
 * at the point and reads its colour back.
 *
 * That is exact rather than approximate: EFFIS renders the FWI in the six
 * discrete danger classes below, not a continuous ramp, so a pixel is one of
 * six known colours and the class it belongs to is the answer.
 */
import { GWIS_BASE } from "@/lib/effis/client";

export interface DangerClass {
  /** 0 (low) to 5 (very extreme). */
  level: number;
  label: string;
  /** The FWI band the class covers. */
  range: string;
  colour: string;
}

/** Sampled from the layer's own legend graphic. */
const CLASSES: (DangerClass & { rgb: [number, number, number] })[] = [
  { level: 0, label: "Low", range: "FWI below 11.2", colour: "#9cffc0", rgb: [156, 255, 192] },
  { level: 1, label: "Moderate", range: "FWI 11.2–21.3", colour: "#cde24e", rgb: [205, 226, 78] },
  { level: 2, label: "High", range: "FWI 21.3–38.0", colour: "#e6ac00", rgb: [230, 172, 0] },
  { level: 3, label: "Very high", range: "FWI 38.0–50.0", colour: "#d97010", rgb: [217, 112, 16] },
  { level: 4, label: "Extreme", range: "FWI 50.0–70.0", colour: "#ad060e", rgb: [173, 6, 14] },
  { level: 5, label: "Very extreme", range: "FWI above 70.0", colour: "#3a0015", rgb: [58, 0, 21] },
];

/** Half-width of the sampled box, in degrees: a fraction of the 8 km grid. */
const SAMPLE_HALF_DEGREES = 0.02;
const LOAD_TIMEOUT_MS = 15_000;
/** The service drops roughly one connection in three, so ask again. */
const ATTEMPTS = 4;
const RETRY_DELAY_MS = 400;

function nearestClass(
  red: number,
  green: number,
  blue: number,
): DangerClass | null {
  let best: DangerClass | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of CLASSES) {
    const [r, g, b] = candidate.rgb;
    const distance = (r - red) ** 2 + (g - green) ** 2 + (b - blue) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  // The palette is discrete, so a pixel far from every class is not the map.
  return bestDistance <= 3 * 40 ** 2 ? best : null;
}

function sampleUrl(latitude: number, longitude: number, day: string): string {
  const d = SAMPLE_HALF_DEGREES;
  const params = new URLSearchParams({
    service: "WMS",
    version: "1.3.0",
    request: "GetMap",
    layers: "ecmwf.fwi",
    styles: "",
    // WMS 1.3.0 orders an EPSG:4326 bbox lat,lon.
    crs: "EPSG:4326",
    bbox: `${latitude - d},${longitude - d},${latitude + d},${longitude + d}`,
    width: "3",
    height: "3",
    format: "image/png",
    transparent: "true",
    time: day,
  });
  return `${GWIS_BASE}?${params}`;
}

function loadOnce(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    // EFFIS allows any origin, so the pixels stay readable.
    image.crossOrigin = "anonymous";
    const timer = setTimeout(
      () => reject(new Error("timed out")),
      LOAD_TIMEOUT_MS,
    );
    image.onload = () => {
      clearTimeout(timer);
      resolve(image);
    };
    image.onerror = () => {
      clearTimeout(timer);
      reject(new Error("could not load the fire danger tile"));
    };
    image.src = url;
  });
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  let lastError: unknown;
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    try {
      // A fresh query each time, so a failure is never served from cache.
      return await loadOnce(attempt === 0 ? url : `${url}&retry=${attempt}`);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
  throw lastError;
}

/**
 * The danger class at a point on one UTC day, or null where the forecast has
 * nothing: out at sea, or past the end of the run.
 */
export async function fetchDangerAt(
  latitude: number,
  longitude: number,
  day: string,
): Promise<DangerClass | null> {
  const image = await loadImage(sampleUrl(latitude, longitude, day));
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;

  context.drawImage(image, 0, 0);
  const middle = {
    x: Math.floor(image.width / 2),
    y: Math.floor(image.height / 2),
  };
  const [red, green, blue, alpha] = context.getImageData(
    middle.x,
    middle.y,
    1,
    1,
  ).data;
  if (alpha < 20) return null;
  return nearestClass(red, green, blue);
}

/** UTC days from today, as the WMS time dimension wants them. */
export function forecastDays(now: Date, count: number): string[] {
  return Array.from({ length: count }, (_, offset) => {
    const day = new Date(now);
    day.setUTCDate(day.getUTCDate() + offset);
    return day.toISOString().slice(0, 10);
  });
}
