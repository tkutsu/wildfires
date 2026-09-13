"use client";

import { useEffect, useState } from "react";
import { fetchGreekHotspotPage } from "@/lib/effis/client";
import { mergeHotspots, topUpSince } from "@/lib/timeline";
import type { Hotspot, HotspotsPayload } from "@/lib/types";
import { dropPersistent, keepConfirmed } from "@/lib/wildfire-filter";

/**
 * EFFIS publishes Greece in two bursts a day, a couple of hours after each
 * satellite pass (02:00-05:00 and 12:00-15:00 UTC), and a detection is two
 * to four hours old by the time it is published. Checking more often than
 * this would only find nothing faster.
 */
const REFRESH_MS = 15 * 60 * 1000;

interface HotspotsState {
  hotspots: Hotspot[];
  loading: boolean;
  error: string | null;
}

/**
 * Loads the season baked at build time, then keeps its live end current
 * straight from EFFIS between deploys.
 *
 * The first top-up reads the days the snapshot does not cover. After that,
 * each check asks only for what EFFIS has published since the last one, so a
 * quiet check costs about a kilobyte. Checks run only while the page is on
 * screen; a tab left in the background asks nothing until it is looked at.
 *
 * New detections are held to the same standard as the baked ones: dropped if
 * they sit on a masked industrial site, and shown only once a second
 * detection confirms them. See lib/wildfire-filter.ts.
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
    let inFlight = false;
    let lastCheck = 0;
    let baked: Hotspot[] | null = null;
    let masked: string[] = [];
    // Everything the top-ups have brought in, by id, so overlaps never double.
    const live = new Map<string, Hotspot>();
    let cursor: string | undefined;

    const schedule = () => {
      if (cancelled || inFlight || document.visibilityState !== "visible") {
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(check, Math.max(0, lastCheck + REFRESH_MS - Date.now()));
    };

    const check = async () => {
      inFlight = true;
      lastCheck = Date.now();
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
        const page = await fetchGreekHotspotPage(
          cursor
            ? { uploadedSince: cursor }
            : { acquiredSince: topUpSince(newest, new Date()) },
        ).catch(() => null);
        if (cancelled) return;

        // A failed check keeps the cursor, so the next one asks again.
        if (page) {
          cursor = page.cursor ?? cursor;
          for (const hotspot of dropPersistent(page.hotspots, masked)) {
            live.set(hotspot.id, hotspot);
          }
        }
        setState({
          hotspots: keepConfirmed(mergeHotspots(baked, [...live.values()])),
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
      } finally {
        inFlight = false;
      }
      schedule();
    };

    // Back on screen after a while: check now if one is due, else resume.
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") schedule();
      else clearTimeout(timer);
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    // The season itself loads even in a background tab; only checks wait.
    void check();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return state;
}
