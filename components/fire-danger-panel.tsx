"use client";

import { useFireDanger, type DangerPoint } from "@/hooks/use-fire-danger";

interface FireDangerPanelProps {
  point: DangerPoint;
  onClose: () => void;
}

function dayLabel(day: string, index: number): string {
  if (index === 0) return "Today";
  if (index === 1) return "Tomorrow";
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
  });
}

/** Fire danger where the pin is, for today and tomorrow. */
export function FireDangerPanel({ point, onClose }: FireDangerPanelProps) {
  const { days, loading, error } = useFireDanger(point);

  return (
    <div className="rounded-2xl border border-ink/15 bg-paper/95 p-3 shadow-xl backdrop-blur">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-xs font-medium tracking-wide uppercase opacity-70">
          Fire danger
        </h2>
        <button
          aria-label="Clear the pin"
          className="-m-1 p-1 text-sm leading-none opacity-60 transition hover:opacity-100"
          onClick={onClose}
          type="button"
        >
          ✕
        </button>
      </div>

      <p className="mt-0.5 text-xs tabular-nums opacity-60">
        {point.latitude.toFixed(3)}°N, {point.longitude.toFixed(3)}°E
      </p>

      {loading && <p className="mt-2 text-sm">Checking the forecast…</p>}
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}

      {!loading && !error && (
        <dl className="mt-2 space-y-1.5">
          {days.map(({ day, danger }, index) => (
            <div className="flex items-center gap-2" key={day}>
              <dt className="w-20 shrink-0 text-sm opacity-70">
                {dayLabel(day, index)}
              </dt>
              <dd className="flex min-w-0 items-center gap-1.5 text-sm">
                <span
                  aria-hidden="true"
                  className="size-2.5 shrink-0 rounded-full ring-1 ring-ink/20"
                  style={{ background: danger?.colour ?? "transparent" }}
                />
                <span className="truncate font-medium">
                  {danger?.label ?? "No forecast"}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      )}

      {!loading && !error && days[0]?.danger && (
        <p className="mt-2 text-[0.7rem] leading-snug opacity-60">
          {days[0].danger.range} · Copernicus EFFIS, ECMWF forecast
        </p>
      )}
    </div>
  );
}
