/**
 * Bakes the EFFIS data the site ships with, so the deployment is static.
 *
 * The heavy work (7 MB of uncompressed GeoJSON, telling this year's
 * wildfires from the industrial heat and the field burning, simplifying 2 MB
 * of perimeters) happens here rather than in every visitor's browser. At
 * runtime the client only tops the season up; see hooks/use-hotspots.ts.
 *
 * When EFFIS will not cooperate, this falls back to the data the live site is
 * already serving, so a code change still ships on a bad day. The site then
 * shows yesterday's bake until the next good one, and the browser's own
 * top-up from EFFIS keeps its live end current meanwhile.
 *
 * Run with: pnpm build:data
 */
import { mkdir, writeFile } from "node:fs/promises";
import { fetchBurntScars, fetchGreekHotspots } from "@/lib/effis/client";
import type { BurntScarsPayload, HotspotsPayload } from "@/lib/types";
import { toWildfires } from "@/lib/wildfire-filter";

const OUT_DIR = new URL("../public/data/", import.meta.url);
/** Where the last good bake lives: the deployed site itself. */
const DEPLOYED_DATA = "https://wildfires.themos.dev/data/";
const FILES = ["season.json", "scars.json"] as const;

/**
 * A trailing year over Greece runs to five figures of detections, and EFFIS
 * maps burnt area every summer. Well under either means the service answered
 * with something broken, which is treated like no answer at all.
 */
const LEAST_CREDIBLE_DETECTIONS = 500;

/** A year back: the window the industrial-heat mask is built from. */
function trailingYear(now: Date): string {
  const from = new Date(now);
  from.setUTCFullYear(from.getUTCFullYear() - 1);
  return from.toISOString().slice(0, 10);
}

/** Fresh data from EFFIS, or an error if it is missing or implausible. */
async function bakeFromEffis() {
  const observedAt = new Date().toISOString();
  const now = new Date(observedAt);
  const [window, scars] = await Promise.all([
    fetchGreekHotspots(trailingYear(now)),
    fetchBurntScars(),
  ]);

  if (window.length < LEAST_CREDIBLE_DETECTIONS) {
    throw new Error(
      `EFFIS returned only ${window.length} detections for the trailing year`,
    );
  }
  if (scars.length === 0) {
    throw new Error("EFFIS returned no burnt-area perimeters");
  }

  // Only this calendar year is shown; the year behind it is what tells the
  // recurring industrial heat apart from the fires.
  const seasonStart = `${now.getUTCFullYear()}-01-01`;
  const { hotspots, persistentCells } = toWildfires(window, seasonStart);

  const season: HotspotsPayload = { hotspots, persistentCells, observedAt };
  const perimeters: BurntScarsPayload = {
    type: "FeatureCollection",
    features: scars,
    totalHectares: scars.reduce(
      (total, scar) => total + scar.properties.areaHa,
      0,
    ),
    observedAt,
  };

  const newest = hotspots.map((hotspot) => hotspot.detectedAt).sort().at(-1);
  const inSeason = window.filter(
    (hotspot) => hotspot.detectedAt.slice(0, 10) >= seasonStart,
  ).length;
  const summary =
    `season.json: ${hotspots.length} wildfire detections of ${inSeason} raw ` +
    `(${persistentCells.length} industrial cells masked), newest ${newest}\n` +
    `scars.json:  ${scars.length} perimeters, ` +
    `${Math.round(perimeters.totalHectares)} hectares`;

  return {
    files: { "season.json": season, "scars.json": perimeters },
    summary,
  };
}

/**
 * The last good bake, from the live site. Checked for the shape the client
 * reads, so a fallback can never publish something the page cannot use.
 */
async function bakeFromDeployment() {
  const files: Record<string, unknown> = {};
  for (const name of FILES) {
    const response = await fetch(`${DEPLOYED_DATA}${name}`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new Error(`${name} from the live site: status ${response.status}`);
    }
    files[name] = await response.json();
  }

  const season = files["season.json"] as Partial<HotspotsPayload>;
  const scars = files["scars.json"] as Partial<BurntScarsPayload>;
  if (!Array.isArray(season.hotspots) || !Array.isArray(scars.features)) {
    throw new Error("The live site's data is not in the expected shape");
  }

  return {
    files,
    summary:
      `season.json: ${season.hotspots.length} detections, baked ${season.observedAt}\n` +
      `scars.json:  ${scars.features.length} perimeters`,
  };
}

/** A warning GitHub shows on the run itself, not buried in its log. */
function warn(message: string) {
  if (process.env.GITHUB_ACTIONS === "true") {
    console.log(`::warning title=Using yesterday's data::${message}`);
  } else {
    console.warn(`Warning: ${message}`);
  }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  let baked;
  try {
    baked = await bakeFromEffis();
  } catch (effisError) {
    warn(
      `EFFIS failed (${String(effisError)}). Redeploying the data the live ` +
        "site already serves instead.",
    );
    try {
      baked = await bakeFromDeployment();
    } catch (fallbackError) {
      // Nothing good to publish at all: fail, and keep the current deployment.
      console.error(`The fallback failed too: ${String(fallbackError)}`);
      throw effisError;
    }
  }

  await Promise.all(
    Object.entries(baked.files).map(([name, payload]) =>
      writeFile(new URL(name, OUT_DIR), JSON.stringify(payload)),
    ),
  );
  console.log(baked.summary);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
