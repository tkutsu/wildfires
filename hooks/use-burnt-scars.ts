"use client";

import { useEffect, useRef, useState } from "react";
import type { BurntScarsPayload } from "@/lib/types";

interface ScarsState {
  payload: BurntScarsPayload | null;
  loading: boolean;
  error: string | null;
}

/**
 * Loads the burnt-area perimeters baked at build time. Unlike the detections
 * these are not topped up live: the query is ~2 MB even filtered to Greece,
 * and EFFIS maps a perimeter days after its fire starts anyway.
 */
export function useBurntScars(): ScarsState {
  const [state, setState] = useState<ScarsState>({
    payload: null,
    loading: false,
    error: null,
  });
  const requestedRef = useRef(false);

  useEffect(() => {
    if (requestedRef.current) return;
    requestedRef.current = true;
    let cancelled = false;

    const load = async () => {
      setState({ payload: null, loading: true, error: null });
      try {
        const response = await fetch("data/scars.json");
        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }
        const payload = (await response.json()) as BurntScarsPayload;
        if (!cancelled) setState({ payload, loading: false, error: null });
      } catch {
        if (!cancelled) {
          setState({
            payload: null,
            loading: false,
            error: "Could not load burnt areas.",
          });
        }
      }
      // A run abandoned mid-flight should not block a later retry.
      if (cancelled) requestedRef.current = false;
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
