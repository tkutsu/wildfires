/**
 * Regenerates lib/past-seasons.json: burnt area in every season EFFIS has
 * mapped before this one, as cumulative hectares by day of the year.
 *
 * Committed rather than fetched on every build: a closed season does not
 * change, and nine requests a day were nine chances for a season to go
 * missing and drag the average it belongs to. Nothing is written unless every
 * season came back.
 *
 * Run once a year, after a season closes, to add it.
 * Run with: pnpm sync:past-seasons
 */
import { writeFile } from "node:fs/promises";
import { FIRST_MAPPED_SEASON, fetchSeason } from "@/lib/effis/client";

const OUT_FILE = new URL("../lib/past-seasons.json", import.meta.url);

async function main() {
  const seasons = [];
  // One at a time, to go easy on a service that is slow at the best of times.
  for (
    let year = FIRST_MAPPED_SEASON;
    year < new Date().getUTCFullYear();
    year += 1
  ) {
    seasons.push(await fetchSeason(year));
  }

  await writeFile(OUT_FILE, `${JSON.stringify(seasons)}\n`);
  for (const { year, steps } of seasons) {
    const total = steps.at(-1)?.[1] ?? 0;
    console.log(`${year}: ${total.toLocaleString("en-GB")} ha`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
