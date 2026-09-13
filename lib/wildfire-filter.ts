/**
 * Separates wildfires from everything else the satellites see burning.
 *
 * A VIIRS hotspot is not a fire report, it is a 375 m pixel that came back
 * hotter than its neighbours. EFFIS says as much, and its own portal runs
 * "a knowledge based algorithm" over surrounding land cover, distance to
 * built-up land and detection confidence before publishing a hotspot. That
 * curated layer is not what the API serves: the live `viirs.hs.*` layers are
 * the raw NASA feed, and the EFFIS layers that carry the verdict fields
 * (`checked`, `flag_lc`, `hs_mask_flag`) stopped being updated in 2021. So
 * the same judgement has to be made here.
 *
 * Two things get dropped.
 *
 * 1. Industrial heat. Refineries, steel mills and their flares burn every
 *    week of the year, and masking sites by their recurrence is the standard
 *    fix in the active-fire literature. Over Greece the pattern is blunt: one
 *    cell by the Elefsina refineries is hot on 117 separate days across 13
 *    months at ~1 MW. No wildfire behaves like that.
 *
 * 2. One-off detections. A wildfire is either wide enough to light more than
 *    one pixel in a single overpass or long enough to be caught by a second
 *    one; with three VIIRS satellites flying, that is roughly six looks a
 *    day. A pixel that is hot once and never again is a field being cleared,
 *    a rubbish fire, or a sunlit metal roof. Over the 2026 season these are
 *    60% of the map's fires but 18% of its detections, and they cluster in
 *    the spring stubble-burning months rather than in the fire season: 45% of
 *    April's detections against 4% of August's.
 *
 * Checked against the burnt-area perimeters EFFIS maps by hand: of the 3,211
 * detections that fall inside one, this drops 6.
 */
import { distanceKm, gridIndex, neighbourKeys } from "@/lib/geo";
import type { Hotspot } from "@/lib/types";

/** ~1.1 km, a few VIIRS pixels wide, so a flare stays in one cell. */
const CELL_DEGREES = 0.01;
/** Recurrence that no seasonal fire reaches but every flare does. */
const PERSISTENT_MIN_DAYS = 6;
const PERSISTENT_MIN_MONTHS = 3;
/** A fire lights pixels near each other, over hours or a few days. */
const LINK_RADIUS_KM = 2;
const LINK_WINDOW_DAYS = 4;

const MS_PER_DAY = 86_400_000;

/** Grid cell a detection falls in, as used by the persistent-source mask. */
export function cellKey(latitude: number, longitude: number): string {
  const round = (value: number) => Math.round(value / CELL_DEGREES);
  return `${round(latitude)}:${round(longitude)}`;
}

/**
 * Cells that keep burning across the year: industrial sites, not wildfires.
 * Wants a long window, a full trailing year, to tell "hot again in March,
 * June and October" apart from "hot for a fortnight in August".
 */
export function findPersistentCells(hotspots: readonly Hotspot[]): string[] {
  const days = new Map<string, Set<string>>();
  const months = new Map<string, Set<string>>();

  for (const hotspot of hotspots) {
    const key = cellKey(hotspot.latitude, hotspot.longitude);
    const day = hotspot.detectedAt.slice(0, 10);
    (days.get(key) ?? days.set(key, new Set()).get(key)!).add(day);
    (months.get(key) ?? months.set(key, new Set()).get(key)!).add(
      day.slice(0, 7),
    );
  }

  return [...days.keys()]
    .filter(
      (key) =>
        days.get(key)!.size >= PERSISTENT_MIN_DAYS &&
        months.get(key)!.size >= PERSISTENT_MIN_MONTHS,
    )
    .sort();
}

/** Drops detections sitting on a known persistent heat source. */
export function dropPersistent(
  hotspots: readonly Hotspot[],
  persistentCells: Iterable<string>,
): Hotspot[] {
  const mask = new Set(persistentCells);
  if (mask.size === 0) return [...hotspots];
  return hotspots.filter(
    (hotspot) => !mask.has(cellKey(hotspot.latitude, hotspot.longitude)),
  );
}

/**
 * Keeps detections that share a fire with at least one other detection,
 * within LINK_RADIUS_KM and LINK_WINDOW_DAYS of it. Idempotent, so the client
 * can re-run it over the baked season plus a fresh tail without the baked
 * part changing its mind.
 */
export function keepConfirmed(hotspots: readonly Hotspot[]): Hotspot[] {
  if (hotspots.length < 2) return [];

  const times = hotspots.map((hotspot) =>
    new Date(hotspot.detectedAt).getTime(),
  );
  const buckets = gridIndex(hotspots, LINK_RADIUS_KM);
  const windowMs = LINK_WINDOW_DAYS * MS_PER_DAY;

  return hotspots.filter((hotspot, index) => {
    for (const key of neighbourKeys(hotspot, LINK_RADIUS_KM)) {
      for (const other of buckets.get(key) ?? []) {
        if (other === index) continue;
        if (Math.abs(times[index] - times[other]) > windowMs) continue;
        if (distanceKm(hotspot, hotspots[other]) <= LINK_RADIUS_KM) return true;
      }
    }
    return false;
  });
}

/**
 * The whole filter, for a trailing window of detections: mask the industrial
 * sites the window reveals, then keep the confirmed fires from `since` on.
 */
export function toWildfires(
  window: readonly Hotspot[],
  since: string,
): { hotspots: Hotspot[]; persistentCells: string[] } {
  const persistentCells = findPersistentCells(window);
  const season = dropPersistent(window, persistentCells).filter(
    (hotspot) => hotspot.detectedAt.slice(0, 10) >= since,
  );
  return { hotspots: keepConfirmed(season), persistentCells };
}
