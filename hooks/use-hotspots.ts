"use client";

import { useEffect, useState } from "react";
import { fetchGreekHotspots } from "@/lib/effis/client";
import { mergeHotspots, topUpSince } from "@/lib/timeline";
import type { Hotspot, HotspotsPayload } from "@/lib/types";
import { dropPersistent, keepConfirmed } from "@/lib/wildfire-filter";

const REFRESH_MS = 5 * 60 * 1000;

interface HotspotsState {
  hotspots: Hotspot[];
  loading: boolean;
  error: string | null;
}

/**
 * Loads the season baked at build time, then tops it up straight from EFFIS
 * so the live end stays current between deploys. Fetching the season live
 * would be megabytes (EFFIS serves WFS uncompressed), so the top-up asks
 * only for the days the snapshot does not already cover.
 *
 * The new detections are held to the same standard as the baked ones: dropped
 * if they sit on a masked industrial site, and shown only once a second
 * detection confirms them. A real fire is confirmed within an overpass or two;
 * see lib/wildfire-filter.ts.
 */
export function useSeasonHotspots(): HotspotsState {
  const [state, setState] = useState<HotspotsState>({
    hotspots: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let baked: Hotspot[] | null = null;
    let masked: string[] = [];

    const load = async () => {
      try {
        if (!baked) {
          const response = await fetch("data/season.json");
          if (!response.ok) {
            throw new Error(`Request failed with status ${response.status}`);
          }
          const payload = (await response.json()) as HotspotsPayload;
          baked = payload.hotspots;
          masked = payload.persistentCells ?? [];
          if (cancelled) return;
          // Show the season immediately; the top-up only adds its tail.
          setState({ hotspots: baked, loading: false, error: null });
        }

        const newest = baked.map((hotspot) => hotspot.detectedAt).sort().at(-1);
        const recent = await fetchGreekHotspots(
          topUpSince(newest, new Date()),
        ).catch(() => [] as Hotspot[]);
        if (cancelled) return;
        setState({
          hotspots: keepConfirmed(
            mergeHotspots(baked, dropPersistent(recent, masked)),
          ),
          loading: false,
          error: null,
        });
      } catch {
        if (!cancelled) {
          setState((previous) => ({
            hotspots: previous.hotspots,
            loading: false,
            error: "Could not load fire detections.",
          }));
        }
      }
      if (!cancelled) timer = setTimeout(load, REFRESH_MS);
    };

    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return state;
}
