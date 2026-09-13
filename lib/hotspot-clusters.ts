import {
  KM_PER_DEGREE_LAT,
  distanceKm,
  gridIndex,
  kmPerDegreeLon,
  neighbourKeys,
} from "@/lib/geo";
import type { Hotspot } from "@/lib/types";

/**
 * Severity is derived from extent: one fire lights up many adjacent 375 m
 * pixels across a day, and a bigger front lights up more of them.
 */
export interface FireCluster {
  id: string;
  latitude: number;
  longitude: number;
  /** Detections merged into this cluster. */
  detections: number;
  /** Rough span of the cluster in kilometres. */
  spanKm: number;
  /** Combined fire radiative power, in megawatts. */
  frpMw: number;
  /** Newest detection in the cluster (ISO). */
  latestAt: string;
  severity: SeverityTier;
}

export type SeverityTier = "spot" | "small" | "moderate" | "large" | "major";

// Detections within this distance are treated as the same fire. A VIIRS pixel
// is 375 m, so this bridges a couple of pixels plus geolocation slop.
const LINK_RADIUS_KM = 2;

export function severityFor(detections: number): SeverityTier {
  if (detections >= 60) return "major";
  if (detections >= 20) return "large";
  if (detections >= 6) return "moderate";
  if (detections >= 2) return "small";
  return "spot";
}

/** Marker size in pixels for a severity tier. */
export const SEVERITY_SIZE: Record<SeverityTier, number> = {
  spot: 18,
  small: 24,
  moderate: 32,
  large: 42,
  major: 54,
};

/**
 * Single-link clusters detections that sit within LINK_RADIUS_KM of each
 * other, bucketing by grid cell so neighbour lookups stay local.
 */
export function clusterHotspots(hotspots: readonly Hotspot[]): FireCluster[] {
  if (hotspots.length === 0) return [];

  const buckets = gridIndex(hotspots, LINK_RADIUS_KM);

  const parent = hotspots.map((_, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    // Path compression keeps repeated lookups flat.
    let cursor = index;
    while (parent[cursor] !== root) {
      const next = parent[cursor];
      parent[cursor] = root;
      cursor = next;
    }
    return root;
  };
  const union = (a: number, b: number) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootB] = rootA;
  };

  hotspots.forEach((hotspot, index) => {
    for (const key of neighbourKeys(hotspot, LINK_RADIUS_KM)) {
      for (const other of buckets.get(key) ?? []) {
        if (other <= index) continue;
        if (distanceKm(hotspot, hotspots[other]) <= LINK_RADIUS_KM) {
          union(index, other);
        }
      }
    }
  });

  const groups = new Map<number, Hotspot[]>();
  hotspots.forEach((hotspot, index) => {
    const root = find(index);
    const group = groups.get(root);
    if (group) group.push(hotspot);
    else groups.set(root, [hotspot]);
  });

  return [...groups.values()]
    .map((group) => {
      const latitude =
        group.reduce((sum, item) => sum + item.latitude, 0) / group.length;
      const longitude =
        group.reduce((sum, item) => sum + item.longitude, 0) / group.length;
      const latitudes = group.map((item) => item.latitude);
      const longitudes = group.map((item) => item.longitude);
      const spanKm = Math.max(
        (Math.max(...latitudes) - Math.min(...latitudes)) * KM_PER_DEGREE_LAT,
        (Math.max(...longitudes) - Math.min(...longitudes)) *
          kmPerDegreeLon(latitude),
      );
      return {
        id: group.reduce(
          (best, item) => (item.id < best ? item.id : best),
          group[0].id,
        ),
        latitude,
        longitude,
        detections: group.length,
        spanKm,
        frpMw: group.reduce((total, item) => total + item.frp, 0),
        latestAt: group.reduce(
          (latest, item) =>
            item.detectedAt > latest ? item.detectedAt : latest,
          group[0].detectedAt,
        ),
        severity: severityFor(group.length),
      };
    })
    // Draw the big ones last so they sit on top.
    .sort((a, b) => a.detections - b.detections);
}
