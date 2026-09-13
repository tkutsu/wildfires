import { describe, expect, it } from "vitest";
import { buildTimeline, mergeHotspots, topUpSince } from "@/lib/timeline";
import type { Hotspot } from "@/lib/types";

function hotspot(detectedAt: string, id = detectedAt): Hotspot {
  return { id, latitude: 38, longitude: 23, detectedAt, frp: 5 };
}

describe("buildTimeline", () => {
  it("returns a single empty day when nothing was detected", () => {
    expect(buildTimeline([], "2026-09-11")).toEqual([
      { date: "2026-09-11", hotspots: [] },
    ]);
  });

  it("groups detections by their UTC day", () => {
    const days = buildTimeline(
      [
        hotspot("2026-08-12T10:49:00Z", "a"),
        hotspot("2026-08-12T23:59:00Z", "b"),
        hotspot("2026-08-13T00:01:00Z", "c"),
      ],
      "2026-08-13",
    );
    expect(days.map((day) => day.hotspots.length)).toEqual([2, 1]);
    expect(days[0].date).toBe("2026-08-12");
  });

  it("keeps quiet days so the scrubber advances at a constant rate", () => {
    const days = buildTimeline(
      [hotspot("2026-08-01T10:00:00Z"), hotspot("2026-08-05T10:00:00Z")],
      "2026-08-05",
    );
    expect(days).toHaveLength(5);
    expect(days.map((day) => day.hotspots.length)).toEqual([1, 0, 0, 0, 1]);
  });

  it("runs through to today even when the last fire was weeks ago", () => {
    const days = buildTimeline([hotspot("2026-09-01T10:00:00Z")], "2026-09-11");
    expect(days).toHaveLength(11);
    expect(days.at(-1)).toEqual({ date: "2026-09-11", hotspots: [] });
  });

  it("does not truncate when detections run past today", () => {
    // A UTC day ahead of the server's clock must still be reachable.
    const days = buildTimeline([hotspot("2026-09-12T02:00:00Z")], "2026-09-11");
    expect(days.at(-1)?.date).toBe("2026-09-12");
  });
});

describe("mergeHotspots", () => {
  it("adds detections the season layer has not published yet", () => {
    const season = [hotspot("2026-09-10T09:00:00Z", "a")];
    const recent = [
      hotspot("2026-09-10T09:00:00Z", "a"),
      hotspot("2026-09-11T14:00:00Z", "b"),
    ];
    const merged = mergeHotspots(season, recent);
    expect(merged.map((h) => h.id)).toEqual(["a", "b"]);
  });

  it("catches a lag of hours, not just whole days", () => {
    const season = [hotspot("2026-09-11T02:00:00Z", "a")];
    const recent = [
      hotspot("2026-09-11T02:00:00Z", "a"),
      hotspot("2026-09-11T18:00:00Z", "b"),
    ];
    expect(mergeHotspots(season, recent)).toHaveLength(2);
  });

  it("is a no-op when the layers agree", () => {
    const season = [hotspot("2026-09-10T09:00:00Z", "a")];
    expect(mergeHotspots(season, [hotspot("2026-09-10T09:00:00Z", "a")])).toEqual(
      season,
    );
  });

  it("never double-counts an id", () => {
    const season = [hotspot("2026-09-10T09:00:00Z", "a")];
    const recent = [
      hotspot("2026-09-10T09:00:00Z", "a"),
      hotspot("2026-09-10T09:00:00Z", "a"),
    ];
    expect(mergeHotspots(season, recent)).toHaveLength(1);
  });

  it("drops the previous season the rolling week reaches back into", () => {
    // Early January: the week layer still carries late-December fires.
    const season = [hotspot("2027-01-02T09:00:00Z", "new")];
    const recent = [hotspot("2026-12-29T09:00:00Z", "old")];
    expect(mergeHotspots(season, recent).map((h) => h.id)).toEqual(["new"]);
  });

  it("falls back to the rolling feed when the season is empty", () => {
    const recent = [hotspot("2026-01-02T09:00:00Z", "a")];
    expect(mergeHotspots([], recent)).toEqual(recent);
  });
});

describe("topUpSince", () => {
  const now = new Date("2026-09-11T12:00:00Z");

  it("reaches back past the newest baked detection", () => {
    // Two days of overlap, so the seam still has neighbours to link against.
    expect(topUpSince("2026-09-11T02:00:00Z", now)).toBe("2026-09-09");
  });

  it("covers the whole gap when the snapshot is stale", () => {
    expect(topUpSince("2026-09-01T11:00:00Z", now)).toBe("2026-08-30");
  });

  it("stops at a month back rather than refetching the season", () => {
    expect(topUpSince("2026-01-04T11:00:00Z", now)).toBe("2026-08-12");
  });

  it("falls back to the longest window when the snapshot is empty", () => {
    expect(topUpSince(undefined, now)).toBe("2026-08-12");
    expect(topUpSince("not-a-date", now)).toBe("2026-08-12");
  });
});
