/** Formats a date as YYYY-MM-DD in UTC (EFFIS acquisition times are UTC). */
export function toUtcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}
