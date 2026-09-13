/** A single satellite fire detection (VIIRS hotspot). */
export interface Hotspot {
  id: string;
  latitude: number;
  longitude: number;
  /** ISO timestamp of the satellite acquisition. */
  detectedAt: string;
  /** Fire radiative power in megawatts: how hard the pixel was burning. */
  frp: number;
}

export interface HotspotsPayload {
  /** This season's wildfire detections, ungrouped; the client buckets by day. */
  hotspots: Hotspot[];
  /**
   * Grid cells masked as persistent industrial heat, derived from a trailing
   * year. Shipped so the client can hold new detections to the same standard.
   */
  persistentCells: string[];
  observedAt: string;
}

export interface ApiErrorPayload {
  error: {
    code: "INVALID_INPUT" | "EFFIS_UNAVAILABLE" | "EFFIS_INVALID_RESPONSE";
    message: string;
    retryable: boolean;
  };
}

export interface LandCoverSlice {
  label: string;
  percent: number;
}

/** One mapped burnt-area perimeter ("scar") with its context. */
export interface BurntScarProperties {
  id: string;
  province: string;
  commune: string;
  /** ISO timestamp the fire was first detected. */
  firedate: string;
  areaHa: number;
  /** Share of the burnt area inside a Natura 2000 protected site. */
  naturaPct: number;
  /** Land cover consumed, biggest share first. */
  landCover: LandCoverSlice[];
}

export interface BurntScar {
  type: "Feature";
  properties: BurntScarProperties;
  geometry: {
    type: "MultiPolygon";
    coordinates: number[][][][];
  };
}

/** One past season, as cumulative hectares stepped by day of the year. */
export interface SeasonHistory {
  year: number;
  /** [dayOfYear, hectares burnt by then], ascending; only days that burnt. */
  steps: [number, number][];
}

export interface BurntScarsPayload {
  type: "FeatureCollection";
  features: BurntScar[];
  totalHectares: number;
  observedAt: string;
}
