import { toUtcDay } from "@/lib/dates";
import type { Hotspot } from "@/lib/types";

/**
 * Folds freshly-published detections into the season. EFFIS regenerates the
 * season layer on its own schedule, so it can trail the rolling feed; anything
 * the rolling feed has that the season does not is added, keyed by id.
 *
 * Detections older than the season's own first day are dropped: across New
 * Year the rolling week reaches back into the previous season.
 */
export function mergeHotspots(
  season: readonly Hotspot[],
  recent: readonly Hotspot[],
): Hotspot[] {
  if (season.length === 0) return [...recent];

  const seen = new Set(season.map((hotspot) => hotspot.id));
  const seasonStart = season.reduce(
    (earliest, hotspot) =>
      hotspot.detectedAt < earliest ? hotspot.detectedAt : earliest,
    season[0].detectedAt,
  ).slice(0, 10);

  const added = recent.filter(
    (hotspot) =>
      !seen.has(hotspot.id) && hotspot.detectedAt.slice(0, 10) >= seasonStart,
  );
  return added.length === 0 ? [...season] : [...season, ...added];
}

export interface TimelineDay {
  date: string;
  hotspots: Hotspot[];
}

/**
 * Buckets a season of detections into a continuous run of days, including the
 * empty ones, so the scrubber advances at a constant rate through winter
 * rather than skipping months.
 */
export function buildTimeline(
  hotspots: readonly Hotspot[],
  today: string,
): TimelineDay[] {
  if (hotspots.length === 0) return [{ date: today, hotspots: [] }];

  const byDate = new Map<string, Hotspot[]>();
  for (const hotspot of hotspots) {
    // acq_at is UTC, so days are UTC days.
    const date = hotspot.detectedAt.slice(0, 10);
    const bucket = byDate.get(date);
    if (bucket) bucket.push(hotspot);
    else byDate.set(date, [hotspot]);
  }

  const dates = [...byDate.keys()].sort();
  const first = dates[0];
  const last = today > dates[dates.length - 1] ? today : dates[dates.length - 1];

  const days: TimelineDay[] = [];
  const cursor = new Date(`${first}T00:00:00Z`);
  const end = new Date(`${last}T00:00:00Z`);
  while (cursor <= end) {
    const date = toUtcDay(cursor);
    days.push({ date, hotspots: byDate.get(date) ?? [] });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

/** Overlap kept so a new detection can be linked to the ones before it. */
const TOP_UP_MARGIN_DAYS = 2;
/** Enough to recover from a long gap without re-fetching the season. */
const TOP_UP_MAX_DAYS = 30;
const MS_PER_DAY = 86_400_000;

/**
 * The UTC day a live top-up should start from, given the newest detection the
 * baked snapshot holds. Asking for less than the whole season keeps the live
 * request small; the margin keeps the fire-linking window honest at the seam.
 */
export function topUpSince(
  newestDetectedAt: string | undefined,
  now: Date,
): string {
  const newest = newestDetectedAt
    ? new Date(newestDetectedAt).getTime()
    : Number.NaN;
  const earliest = now.getTime() - TOP_UP_MAX_DAYS * MS_PER_DAY;
  return toUtcDay(
    new Date(
      Number.isNaN(newest)
        ? earliest
        : Math.max(earliest, newest - TOP_UP_MARGIN_DAYS * MS_PER_DAY),
    ),
  );
}
