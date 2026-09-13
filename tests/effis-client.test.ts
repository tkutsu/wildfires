import { describe, expect, it } from "vitest";
import { toHotspotPage } from "@/lib/effis/client";

function feature(id: string, uploadAt: string | null | undefined) {
  return {
    type: "Feature",
    properties: {
      id,
      acq_at: "2026-09-13 00:37:00",
      frp: "4.2",
      ...(uploadAt === undefined ? {} : { upload_at: uploadAt }),
    },
    geometry: { type: "Point", coordinates: [23.1, 38.2] },
  };
}

describe("toHotspotPage", () => {
  it("takes the newest upload as the cursor, whatever the order", () => {
    const page = toHotspotPage({
      features: [
        feature("a", "2026-09-13 02:32:57.120334"),
        feature("b", "2026-09-13 04:11:53.004211"),
        feature("c", "2026-09-12 14:04:52.998001"),
      ],
    });
    expect(page.cursor).toBe("2026-09-13 04:11:53.004211");
    expect(page.hotspots.map((hotspot) => hotspot.id)).toEqual(["a", "b", "c"]);
  });

  it("has no cursor when nothing was published", () => {
    expect(toHotspotPage({ features: [] })).toEqual({
      hotspots: [],
      cursor: undefined,
    });
  });

  it("ignores rows without an upload time rather than failing", () => {
    const page = toHotspotPage({
      features: [feature("a", null), feature("b", undefined)],
    });
    expect(page.cursor).toBeUndefined();
    expect(page.hotspots).toHaveLength(2);
  });

  it("reads coordinates, UTC acquisition time and radiative power", () => {
    const [hotspot] = toHotspotPage({
      features: [feature("a", "2026-09-13 02:32:57")],
    }).hotspots;
    expect(hotspot).toEqual({
      id: "a",
      latitude: 38.2,
      longitude: 23.1,
      detectedAt: "2026-09-13T00:37:00Z",
      frp: 4.2,
    });
  });
});
