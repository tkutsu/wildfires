import { describe, expect, it } from "vitest";
import { clusterHotspots, severityFor } from "@/lib/hotspot-clusters";
import type { Hotspot } from "@/lib/types";

function hotspot(
  id: string,
  latitude: number,
  longitude: number,
  detectedAt = "2026-08-12T10:00:00Z",
): Hotspot {
  return { id, latitude, longitude, detectedAt, frp: 5 };
}

describe("clusterHotspots", () => {
  it("returns nothing for no detections", () => {
    expect(clusterHotspots([])).toEqual([]);
  });

  it("merges detections within the link radius", () => {
    // Three pixels ~0.4 km apart: one fire.
    const clusters = clusterHotspots([
      hotspot("a", 38.0, 23.0),
      hotspot("b", 38.0036, 23.0),
      hotspot("c", 38.0072, 23.0),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].detections).toBe(3);
    expect(clusters[0].latitude).toBeCloseTo(38.0036, 3);
  });

  it("keeps distant detections apart", () => {
    const clusters = clusterHotspots([
      hotspot("a", 38.0, 23.0),
      hotspot("b", 39.0, 24.0),
    ]);
    expect(clusters).toHaveLength(2);
  });

  it("chains a fire front through single links", () => {
    // Each step is under the radius, so the whole front is one fire even
    // though the ends are far apart.
    const front = Array.from({ length: 12 }, (_, index) =>
      hotspot(`f${index}`, 38 + index * 0.015, 23),
    );
    const clusters = clusterHotspots(front);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].spanKm).toBeGreaterThan(15);
  });

  it("reports the newest detection and orders small fires first", () => {
    const clusters = clusterHotspots([
      hotspot("a", 38.0, 23.0, "2026-08-12T09:00:00Z"),
      hotspot("b", 38.003, 23.0, "2026-08-12T21:30:00Z"),
      hotspot("c", 40.0, 25.0, "2026-08-12T08:00:00Z"),
    ]);
    expect(clusters[0].detections).toBe(1);
    const big = clusters.at(-1);
    expect(big?.detections).toBe(2);
    expect(big?.latestAt).toBe("2026-08-12T21:30:00Z");
  });
});

describe("severityFor", () => {
  it("maps detection counts onto tiers", () => {
    expect(severityFor(1)).toBe("spot");
    expect(severityFor(3)).toBe("small");
    expect(severityFor(10)).toBe("moderate");
    expect(severityFor(25)).toBe("large");
    expect(severityFor(120)).toBe("major");
  });
});
