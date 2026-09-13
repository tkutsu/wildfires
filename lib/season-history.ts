/**
 * How this season compares with the ones before it.
 *
 * "34,001 hectares" means nothing on its own. Against the nine seasons EFFIS
 * has mapped it means a great deal: 2023 had burnt 174,000 by mid-September
 * and 2019 had burnt 8,000. The comparison is made day for day, this year to
 * date against the same date in each past year, so it stays honest while the
 * timeline is scrubbed back through a season that had not finished yet.
 */
import pastSeasons from "@/lib/past-seasons.json";
import type { SeasonHistory } from "@/lib/types";

/** Committed by scripts/sync-past-seasons.ts; see there for why. */
export const PAST_SEASONS = pastSeasons as SeasonHistory[];

/** Day of the year, 1-366, for a UTC "YYYY-MM-DD". */
export function dayOfYear(day: string): number {
  const date = new Date(`${day}T00:00:00Z`);
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  return Math.floor((date.getTime() - start) / 86_400_000) + 1;
}

/** Hectares burnt in that year up to and including `day`. */
export function hectaresByDay(
  steps: readonly (readonly [number, number])[],
  day: number,
): number {
  let total = 0;
  for (const [stepDay, hectares] of steps) {
    if (stepDay > day) break;
    total = hectares;
  }
  return total;
}

/** Mean hectares burnt by this day of the year across the mapped seasons. */
export function averageByDay(
  history: readonly SeasonHistory[],
  day: number,
): number {
  if (history.length === 0) return 0;
  const total = history.reduce(
    (sum, season) => sum + hectaresByDay(season.steps, day),
    0,
  );
  return total / history.length;
}

export interface SeasonComparison {
  /** This year over the average for the date; 1 is exactly average. */
  ratio: number;
  /** Reads on its own, e.g. "67% of the 2017–2025 average". */
  label: string;
}

/**
 * Null before there is anything to compare (early January, where a ratio
 * against nearly zero would be noise), and null when a season is missing from
 * the middle of the run. An average with a hole in it is not the average its
 * label claims, and saying nothing beats saying something wrong.
 */
export function compareWithHistory(
  history: readonly SeasonHistory[],
  day: string,
  hectaresSoFar: number,
): SeasonComparison | null {
  if (history.length === 0) return null;
  const years = history.map((season) => season.year).sort((a, b) => a - b);
  const unbroken = years.every(
    (year, index) => index === 0 || year === years[index - 1] + 1,
  );
  if (!unbroken) return null;

  const average = averageByDay(history, dayOfYear(day));
  if (average < 100) return null;

  const span = `${years[0]}–${years[years.length - 1]}`;
  const ratio = hectaresSoFar / average;
  const label =
    ratio >= 1.1
      ? `${ratio.toFixed(1)}× the ${span} average`
      : `${Math.round(ratio * 100)}% of the ${span} average`;
  return { ratio, label };
}
