import { z } from "zod";
import { dayOfYear } from "@/lib/season-history";
import { simplifyPolygons, type Position } from "@/lib/simplify";
import type {
  BurntScar,
  Hotspot,
  LandCoverSlice,
  SeasonHistory,
} from "@/lib/types";

export const GWIS_BASE = "https://maps.effis.emergency.copernicus.eu/gwis";
const EFFIS_BASE = "https://maps.effis.emergency.copernicus.eu/effis";
const TIMEOUT_MS = 60_000;
/** EFFIS truncates the odd response; one failure is not worth a build. */
const ATTEMPTS = 3;
const RETRY_DELAY_MS = 500;

/**
 * The detection layer to read. `viirs.hs.query` is the only live one that
 * carries the fields a wildfire can be recognised by (fire radiative power
 * and a per-detection country), where `viirs.hs.season` serves id, timestamp
 * and nothing else. It holds a trailing year, which is also the window the
 * industrial-heat mask needs.
 */
const HOTSPOT_LAYER = "viirs.hs.query";

const pointFeatureSchema = z.object({
  properties: z.object({
    id: z.union([z.string(), z.number()]),
    acq_at: z.string(),
    // Numbers arrive as strings on this layer.
    frp: z.union([z.string(), z.number()]).nullable().optional(),
    upload_at: z.string().nullable().optional(),
  }),
  geometry: z.object({
    type: z.literal("Point"),
    coordinates: z.tuple([z.number(), z.number()]).rest(z.number()),
  }),
});

const hotspotCollectionSchema = z.object({
  features: z.array(pointFeatureSchema),
});

async function fetchOnce(base: string, params: URLSearchParams) {
  const response = await fetch(`${base}?${params}`, {
    headers: {
      // EFFIS hangs on requests without a User-Agent.
      "User-Agent": "greek-fires-prototype/0.1 (personal project)",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`EFFIS responded with status ${response.status}`);
  }
  return response.json() as Promise<unknown>;
}

/** Retried, because EFFIS now and then cuts a response short. */
async function fetchEffisJson(base: string, params: URLSearchParams) {
  let lastError: unknown;
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    try {
      return await fetchOnce(base, params);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
  throw lastError;
}

export interface HotspotPage {
  hotspots: Hotspot[];
  /**
   * The newest `upload_at` in the page, verbatim, or undefined when it is
   * empty. Passed back as `uploadedSince` it asks for what arrived after.
   */
  cursor: string | undefined;
}

export function toHotspotPage(payload: unknown): HotspotPage {
  const collection = hotspotCollectionSchema.parse(payload);
  let cursor: string | undefined;
  const hotspots = collection.features.map((feature) => {
    const [longitude, latitude] = feature.geometry.coordinates;
    const frp = Number(feature.properties.frp);
    const uploadedAt = feature.properties.upload_at;
    // Same "YYYY-MM-DD HH:MM:SS.ffffff" shape throughout, so strings compare.
    if (uploadedAt && (!cursor || uploadedAt > cursor)) cursor = uploadedAt;
    return {
      id: String(feature.properties.id),
      latitude,
      longitude,
      // acq_at is UTC "YYYY-MM-DD HH:MM:SS".
      detectedAt: `${feature.properties.acq_at.replace(" ", "T")}Z`,
      frp: Number.isFinite(frp) ? frp : 0,
    };
  });
  return { hotspots, cursor };
}

/**
 * Greek detections, by when the satellite saw them or by when EFFIS published
 * them.
 *
 * `acquiredSince` (a UTC day) is how the season is read. `uploadedSince` is
 * how a page already holding the season stays current: it returns only what
 * EFFIS has published since the cursor, however long ago the pass itself was,
 * so a quiet poll costs a kilobyte and a late upload is never missed.
 *
 * Both filters run on the server. `gid_0` is EFFIS's own country assignment,
 * which beats clipping a bbox to a hand-drawn coastline: it keeps the
 * islands and drops the Turkish and Bulgarian fires the old bbox swept in.
 *
 * Runs in the browser too: the User-Agent header is forbidden there and is
 * dropped silently, which is fine because EFFIS only objects to requests with
 * *no* User-Agent at all.
 */
export async function fetchGreekHotspotPage(
  from: { acquiredSince: string } | { uploadedSince: string },
): Promise<HotspotPage> {
  const [property, literal] =
    "acquiredSince" in from
      ? ["acq_at", from.acquiredSince]
      : ["upload_at", from.uploadedSince];
  const params = new URLSearchParams({
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typenames: HOTSPOT_LAYER,
    outputformat: "geojson",
    count: "200000",
    filter:
      "<Filter><And>" +
      "<PropertyIsEqualTo><PropertyName>gid_0</PropertyName>" +
      "<Literal>GRC</Literal></PropertyIsEqualTo>" +
      // Inclusive, so a batch sharing the cursor's timestamp is not cut in
      // two; the overlap it returns is dropped by id.
      `<PropertyIsGreaterThanOrEqualTo><PropertyName>${property}</PropertyName>` +
      `<Literal>${literal}</Literal>` +
      "</PropertyIsGreaterThanOrEqualTo>" +
      "</And></Filter>",
  });
  return toHotspotPage(await fetchEffisJson(GWIS_BASE, params));
}

/** Greek detections acquired from `since` (a UTC day) onwards. */
export async function fetchGreekHotspots(since: string): Promise<Hotspot[]> {
  return (await fetchGreekHotspotPage({ acquiredSince: since })).hotspots;
}

const LAND_COVER_FIELDS: [string, string][] = [
  ["BROADLEA", "Broadleaved forest"],
  ["CONIFER", "Conifer forest"],
  ["MIXED", "Mixed forest"],
  ["SCLEROPH", "Sclerophyllous vegetation"],
  ["TRANSIT", "Transitional woodland"],
  ["OTHERNATLC", "Other natural land"],
  ["AGRIAREAS", "Agricultural land"],
  ["ARTIFSURF", "Built-up land"],
  ["OTHERLC", "Other"],
];

const scarFeatureSchema = z.object({
  properties: z.record(z.string(), z.union([z.string(), z.number()]).nullable()),
  geometry: z.union([
    z.object({
      type: z.literal("Polygon"),
      coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))),
    }),
    z.object({
      type: z.literal("MultiPolygon"),
      coordinates: z.array(
        z.array(z.array(z.tuple([z.number(), z.number()]))),
      ),
    }),
  ]),
});

const scarCollectionSchema = z.object({
  features: z.array(scarFeatureSchema),
});

function percent(value: string | number | null | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Drops the administrative prefix Greek commune names carry. */
function tidyCommune(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed === "N.A.") return "";
  return trimmed.replace(
    /^(Τοπική Κοινότητα|Δημοτική Κοινότητα|Δημοτική Ενότητα|Κοινότητα)\s+/,
    "",
  );
}

/**
 * This season's mapped burnt-area perimeters for Greece, simplified for the
 * browser. Unlike the filtered hotspot queries, polygon geometry arrives in
 * standard lon,lat order.
 */
export async function fetchBurntScars(): Promise<BurntScar[]> {
  const params = new URLSearchParams({
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typenames: "modis.ba.poly.season",
    outputformat: "geojson",
    count: "5000",
    filter:
      "<Filter><PropertyIsEqualTo><PropertyName>COUNTRY</PropertyName>" +
      "<Literal>EL</Literal></PropertyIsEqualTo></Filter>",
  });
  const collection = scarCollectionSchema.parse(
    await fetchEffisJson(EFFIS_BASE, params),
  );

  return collection.features
    .map((feature, index) => {
      const properties = feature.properties;
      const polygons =
        feature.geometry.type === "Polygon"
          ? [feature.geometry.coordinates as Position[][]]
          : (feature.geometry.coordinates as Position[][][]);
      const landCover: LandCoverSlice[] = LAND_COVER_FIELDS.map(
        ([field, label]) => ({ label, percent: percent(properties[field]) }),
      )
        .filter((slice) => slice.percent >= 1)
        .sort((a, b) => b.percent - a.percent);

      return {
        type: "Feature" as const,
        properties: {
          id: String(properties.id ?? index),
          province: String(properties.PROVINCE ?? "").trim(),
          commune: tidyCommune(String(properties.COMMUNE ?? "")),
          firedate: String(properties.FIREDATE ?? "").replace(" ", "T"),
          areaHa: percent(properties.AREA_HA),
          naturaPct: percent(properties.PERCNA2K),
          landCover,
        },
        geometry: {
          type: "MultiPolygon" as const,
          coordinates: simplifyPolygons(polygons),
        },
      };
    })
    .filter((scar) => scar.geometry.coordinates.length > 0)
    // Draw the big scars first so small ones stay clickable on top.
    .sort((a, b) => b.properties.areaHa - a.properties.areaHa);
}

/** EFFIS publishes a mapped burnt-area layer per year; 2016 and older are gone. */
export const FIRST_MAPPED_SEASON = 2017;

const seasonRowSchema = z.object({
  properties: z.object({
    AREA_HA: z.union([z.string(), z.number()]).nullable().optional(),
    FIREDATE: z.string().nullable().optional(),
  }),
});

/**
 * One past season as a cumulative curve. Only the totals are kept; the
 * geometry comes down too, but none of it is worth shipping to a browser.
 *
 * No `propertyname` to trim the attributes: on some years' layers (2018 and
 * 2022 among them) EFFIS answers a propertyname list with an empty body when
 * its comma arrives percent-encoded, which URLSearchParams always does. The
 * full attributes cost about 3% more.
 */
export async function fetchSeason(year: number): Promise<SeasonHistory> {
  const params = new URLSearchParams({
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typenames: `modis.ba.poly.${year}`,
    outputformat: "geojson",
    count: "20000",
    filter:
      "<Filter><PropertyIsEqualTo><PropertyName>COUNTRY</PropertyName>" +
      "<Literal>EL</Literal></PropertyIsEqualTo></Filter>",
  });
  const collection = z
    .object({ features: z.array(seasonRowSchema) })
    .parse(await fetchEffisJson(EFFIS_BASE, params));

  const byDay = new Map<number, number>();
  for (const { properties } of collection.features) {
    const firedate = (properties.FIREDATE ?? "").slice(0, 10);
    if (!firedate) continue;
    const day = dayOfYear(firedate);
    byDay.set(day, (byDay.get(day) ?? 0) + percent(properties.AREA_HA));
  }

  let running = 0;
  const steps = [...byDay.entries()]
    .sort(([a], [b]) => a - b)
    .map(([day, hectares]): [number, number] => {
      running += hectares;
      return [day, Math.round(running)];
    });
  return { year, steps };
}
