"use client";

import { useEffect, useState } from "react";
import {
  fetchDangerAt,
  forecastDays,
  type DangerClass,
} from "@/lib/effis/fire-danger";

export interface DangerPoint {
  latitude: number;
  longitude: number;
}

export interface DangerDay {
  /** UTC day, ISO. */
  day: string;
  /** null where the forecast has no value for the point. */
  danger: DangerClass | null;
}

interface FireDangerState {
  days: DangerDay[];
  loading: boolean;
  error: string | null;
}

const IDLE: FireDangerState = { days: [], loading: false, error: null };
const LOADING: FireDangerState = { days: [], loading: true, error: null };

function keyOf(point: DangerPoint): string {
  return `${point.latitude},${point.longitude}`;
}

/**
 * Today and tomorrow's fire danger at a point, refetched when it moves.
 *
 * The answer is stored against the point it was fetched for, so moving the pin
 * reads as loading until its own forecast lands rather than briefly showing
 * the last place's.
 */
export function useFireDanger(point: DangerPoint | null): FireDangerState {
  const [result, setResult] = useState<{
    key: string;
    state: FireDangerState;
  } | null>(null);

  useEffect(() => {
    if (!point) return;
    const key = keyOf(point);
    let cancelled = false;

    const load = async () => {
      try {
        const days = forecastDays(new Date(), 2);
        const danger = await Promise.all(
          days.map((day) =>
            fetchDangerAt(point.latitude, point.longitude, day),
          ),
        );
        if (cancelled) return;
        setResult({
          key,
          state: {
            days: days.map((day, index) => ({ day, danger: danger[index] })),
            loading: false,
            error: null,
          },
        });
      } catch {
        if (cancelled) return;
        setResult({
          key,
          state: {
            days: [],
            loading: false,
            error: "Could not reach the fire danger forecast.",
          },
        });
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [point]);

  if (!point) return IDLE;
  return result?.key === keyOf(point) ? result.state : LOADING;
}
