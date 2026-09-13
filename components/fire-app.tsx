"use client";

import { useCallback, useMemo, useState } from "react";
import { FireDangerPanel } from "@/components/fire-danger-panel";
import { FireMap } from "@/components/fire-map";
import { TimelineControls } from "@/components/timeline-controls";
import type { DangerPoint } from "@/hooks/use-fire-danger";
import { useBurntScars } from "@/hooks/use-burnt-scars";
import { useSeasonHotspots } from "@/hooks/use-hotspots";
import { toUtcDay } from "@/lib/dates";
import { PAST_SEASONS, compareWithHistory } from "@/lib/season-history";
import { buildTimeline } from "@/lib/timeline";

function toggleTheme() {
  const next =
    document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try {
    window.localStorage.setItem("fires-theme", next);
  } catch {
    // Private browsing: theme simply resets next visit.
  }
}

function formatDay(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

/* Sized by the caller so the same glyph works in any control. */
function MoonIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 16 16">
      <path
        d="M13.8 9.9A5.6 5.6 0 0 1 6.1 2.2a5.9 5.9 0 1 0 7.7 7.7Z"
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.4"
      />
    </svg>
  );
}

function LayersIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 16 16">
      <g
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.4"
      >
        <path d="M8 1.6 14.4 5 8 8.4 1.6 5 8 1.6Z" />
        <path d="m2.6 8 5.4 2.9L13.4 8" />
        <path d="m2.6 11.1 5.4 2.9 5.4-2.9" />
      </g>
    </svg>
  );
}

function PinIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 16 16">
      <g
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.4"
      >
        <circle cx="8" cy="8" r="2.6" />
        <circle cx="8" cy="8" r="5.6" />
        <path d="M8 0.8v1.8M8 13.4v1.8M0.8 8h1.8M13.4 8h1.8" />
      </g>
    </svg>
  );
}

function SunIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 16 16">
      <g
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.4"
      >
        <circle cx="8" cy="8" r="3.2" />
        <path d="M8 1.4v1.6M8 13v1.6M1.4 8H3M13 8h1.6M3.33 3.33l1.13 1.13M11.54 11.54l1.13 1.13M3.33 12.67l1.13-1.13M11.54 4.46l1.13-1.13" />
      </g>
    </svg>
  );
}

export function FireApp() {
  const [dayIndex, setDayIndex] = useState<number | null>(null);
  // Transitions are reserved for playback; scrubbing by hand stays instant.
  const [playing, setPlaying] = useState(false);
  const [pin, setPin] = useState<DangerPoint | null>(null);
  const [locating, setLocating] = useState(false);
  const [imagery, setImagery] = useState(false);
  const [imageryMissing, setImageryMissing] = useState(false);

  const today = useMemo(() => toUtcDay(new Date()), []);
  const { hotspots, loading, error } = useSeasonHotspots();
  const scars = useBurntScars();

  const days = useMemo(
    () => buildTimeline(hotspots, today),
    [hotspots, today],
  );

  // Follow the live end until the timeline is scrubbed. Clamping also covers
  // the season growing a day while a past day is selected.
  const activeIndex = Math.min(dayIndex ?? days.length - 1, days.length - 1);
  const activeDay = days[activeIndex];
  const isLive = activeIndex === days.length - 1;

  // Only fires that had started by the selected day count towards the total.
  const hectaresSoFar = useMemo(
    () =>
      (scars.payload?.features ?? []).reduce(
        (total, scar) =>
          scar.properties.firedate.slice(0, 10) <= activeDay.date
            ? total + scar.properties.areaHa
            : total,
        0,
      ),
    [scars.payload, activeDay.date],
  );

  // NASA has no pass for the day yet, or none over Greece.
  const onImageryLoaded = useCallback(
    (available: boolean) => setImageryMissing(!available),
    [],
  );

  const comparison = useMemo(
    () =>
      scars.payload
        ? compareWithHistory(PAST_SEASONS, activeDay.date, hectaresSoFar)
        : null,
    [scars.payload, activeDay.date, hectaresSoFar],
  );

  const locate = () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        setPin({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
      },
      // Denied or unavailable: the map is still there to be clicked.
      () => setLocating(false),
      { timeout: 10_000, maximumAge: 300_000 },
    );
  };

  return (
    <div className="flex h-dvh flex-col">
      <div className="relative flex min-h-0 flex-1">
        <FireMap
          animated={playing}
          hotspots={activeDay.hotspots}
          imagery={imagery}
          onImageryLoaded={onImageryLoaded}
          onPickPoint={setPin}
          pin={pin}
          scarDay={activeDay.date}
          scars={scars.payload}
        />

        <div className="pointer-events-none absolute top-3 left-14 z-[500] flex flex-col items-start gap-1.5">
          {loading && (
            <span className="rounded-full bg-paper/90 px-3 py-1 text-xs shadow-lg backdrop-blur">
              Loading the season…
            </span>
          )}
          {error && (
            <span className="rounded-full bg-red-50 px-3 py-1 text-xs text-red-800 shadow-lg">
              {error}
            </span>
          )}
          {scars.payload && (
            <span className="rounded-full bg-paper/90 px-3 py-1 text-xs shadow-lg backdrop-blur">
              {Math.round(hectaresSoFar).toLocaleString("en-GB")} hectares
              burnt {isLive ? "this year" : `by ${formatDay(activeDay.date)}`}
            </span>
          )}
          {comparison && (
            <span className="rounded-full bg-paper/90 px-3 py-1 text-xs shadow-lg backdrop-blur">
              {comparison.label}
            </span>
          )}
          {!loading && !error && hotspots.length > 0 && (
            <span className="rounded-full bg-paper/90 px-3 py-1 text-xs shadow-lg backdrop-blur">
              {activeDay.hotspots.length === 0
                ? "No fire detections"
                : `${activeDay.hotspots.length} detection${
                    activeDay.hotspots.length === 1 ? "" : "s"
                  }`}
            </span>
          )}
        </div>

        <div className="absolute top-3 right-3 z-[500] flex flex-col items-end gap-2">
          <div className="flex gap-2">
            <button
              aria-label="Satellite imagery for this day"
              aria-pressed={imagery}
              className={`flex size-9 items-center justify-center rounded-full border shadow-lg backdrop-blur transition ${
                imagery
                  ? "border-signal bg-signal text-white"
                  : "border-ink/15 bg-paper/90 hover:bg-paper"
              }`}
              onClick={() => {
                setImageryMissing(false);
                setImagery((on) => !on);
              }}
              type="button"
            >
              <LayersIcon className="size-4" />
            </button>
            <button
              aria-label="Fire danger at my location"
              className="flex size-9 items-center justify-center rounded-full border border-ink/15 bg-paper/90 shadow-lg backdrop-blur transition hover:bg-paper"
              onClick={locate}
              type="button"
            >
              <PinIcon className={`size-4 ${locating ? "animate-pulse" : ""}`} />
            </button>
            <button
              aria-label="Toggle dark mode"
              className="flex size-9 items-center justify-center rounded-full border border-ink/15 bg-paper/90 shadow-lg backdrop-blur transition hover:bg-paper"
              onClick={toggleTheme}
              type="button"
            >
              <MoonIcon className="size-4 dark:hidden" />
              <SunIcon className="hidden size-4 dark:block" />
            </button>
          </div>

          {imagery && imageryMissing && (
            <p className="rounded-full bg-paper/90 px-3 py-1 text-right text-xs opacity-80 shadow-lg backdrop-blur">
              No satellite pass for {formatDay(activeDay.date)} yet
            </p>
          )}
          {!pin && (
            <p className="rounded-full bg-paper/90 px-3 py-1 text-xs opacity-80 shadow-lg backdrop-blur">
              Tap the map for fire danger
            </p>
          )}
        </div>

        {/* Above the timeline on a phone, under the buttons where there is
            room for it: the top-left readouts have the narrow screen. */}
        {pin && (
          <div className="absolute right-3 bottom-24 left-3 z-[500] sm:top-14 sm:bottom-auto sm:left-auto sm:w-60">
            <FireDangerPanel onClose={() => setPin(null)} point={pin} />
          </div>
        )}

        {days.length > 1 && (
          <TimelineControls
            days={days}
            index={activeIndex}
            onPlayingChange={setPlaying}
            onSelect={setDayIndex}
            playing={playing}
          />
        )}
      </div>
    </div>
  );
}
