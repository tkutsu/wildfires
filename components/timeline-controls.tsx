"use client";

import { useEffect, useMemo } from "react";
import type { TimelineDay } from "@/lib/timeline";

const PLAY_STEP_MS = 220;

interface TimelineControlsProps {
  days: readonly TimelineDay[];
  index: number;
  onSelect: (index: number) => void;
  /** Lifted so the map knows to animate only while the season is playing. */
  playing: boolean;
  onPlayingChange: (playing: boolean) => void;
}

function formatDay(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

/**
 * Scrubs the whole season. The track doubles as a chart of detections per day,
 * so the fire season's shape is visible and its peaks are targets to aim at.
 */
export function TimelineControls({
  days,
  index,
  onSelect,
  playing,
  onPlayingChange,
}: TimelineControlsProps) {
  const last = days.length - 1;
  const atEnd = index >= last;

  const peak = useMemo(
    () => Math.max(1, ...days.map((day) => day.hotspots.length)),
    [days],
  );

  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => {
      if (atEnd) {
        onPlayingChange(false);
        return;
      }
      onSelect(index + 1);
    }, PLAY_STEP_MS);
    return () => clearTimeout(timer);
  }, [playing, index, atEnd, onSelect, onPlayingChange]);

  const current = days[index];

  return (
    <div className="absolute right-3 bottom-6 left-3 z-[500] mx-auto flex max-w-[44rem] items-center gap-2 rounded-2xl border border-ink/15 bg-paper/90 px-3 py-3 shadow-xl backdrop-blur sm:gap-3 sm:px-4">
      <button
        aria-label={playing ? "Pause" : "Play the season"}
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-signal text-white shadow-sm transition hover:brightness-110"
        onClick={() => {
          // Replaying from the end restarts at the first day.
          if (!playing && atEnd) onSelect(0);
          onPlayingChange(!playing);
        }}
        type="button"
      >
        {playing ? (
          <svg aria-hidden="true" className="size-4" viewBox="0 0 16 16">
            <path d="M4 2h3v12H4zM9 2h3v12H9z" fill="currentColor" />
          </svg>
        ) : (
          <svg aria-hidden="true" className="size-4" viewBox="0 0 16 16">
            <path d="M4 2l9 6-9 6z" fill="currentColor" />
          </svg>
        )}
      </button>

      <div className="relative min-w-0 flex-1">
        <svg
          aria-hidden="true"
          className="block h-8 w-full"
          preserveAspectRatio="none"
          viewBox={`0 0 ${days.length} 100`}
        >
          {days.map((day, dayIndex) => {
            const height = (day.hotspots.length / peak) * 100;
            if (height === 0) return null;
            return (
              <rect
                key={day.date}
                fill="var(--chart-bar)"
                height={Math.max(height, 2)}
                opacity={dayIndex === index ? 1 : 0.45}
                width={1}
                x={dayIndex}
                y={100 - Math.max(height, 2)}
              />
            );
          })}
        </svg>
        <input
          aria-label="Day of the fire season"
          aria-valuetext={current ? formatDay(current.date) : undefined}
          className="fire-range absolute inset-0 w-full"
          max={last}
          min={0}
          onChange={(event) => {
            onPlayingChange(false);
            onSelect(Number(event.target.value));
          }}
          type="range"
          value={index}
        />
      </div>

      <span className="w-16 shrink-0 text-right text-sm tabular-nums">
        {current ? formatDay(current.date) : ""}
      </span>
    </div>
  );
}
