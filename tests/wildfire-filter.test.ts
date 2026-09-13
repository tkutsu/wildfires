import { describe, expect, it } from "vitest";
import type { Hotspot } from "@/lib/types";
import {
  cellKey,
  dropPersistent,
  findPersistentCells,
  keepConfirmed,
  toWildfires,
} from "@/lib/wildfire-filter";

let sequence = 0;

function hotspot(
  detectedAt: string,
  latitude = 38,
  longitude = 23,
  frp = 5,
): Hotspot {
  sequence += 1;
  return { id: `h${sequence}`, latitude, longitude, detectedAt, frp };
}

/** A detection on each of `days`, all in the same place. */
function onDays(days: readonly string[], latitude = 38, longitude = 23) {
  return days.map((day) => hotspot(`${day}T10:00:00Z`, latitude, longitude));
}

describe("cellKey", () => {
  it("puts detections a few hundred metres apart in one cell", () => {
    expect(cellKey(38.1312, 23.5281)).toBe(cellKey(38.1287, 23.5324));
  });

  it("separates detections a couple of kilometres apart", () => {
    expect(cellKey(38.131, 23.526)).not.toBe(cellKey(38.161, 23.526));
  });
});

describe("findPersistentCells", () => {
  it("masks a site that keeps burning across the year", () => {
    // A refinery flare: hot most weeks, never for long.
    const flare = onDays([
      "2026-01-04",
      "2026-02-11",
      "2026-04-02",
      "2026-06-19",
      "2026-08-07",
      "2026-11-23",
    ]);
    expect(findPersistentCells(flare)).toEqual([cellKey(38, 23)]);
  });

  it("leaves a fire that burns hard for one stretch", () => {
    // Ten days of a August wildfire is not recurrence.
    const wildfire = onDays([
      "2026-08-01",
      "2026-08-02",
      "2026-08-03",
      "2026-08-04",
      "2026-08-05",
      "2026-08-06",
      "2026-08-07",
      "2026-08-08",
      "2026-08-09",
      "2026-08-10",
    ]);
    expect(findPersistentCells(wildfire)).toEqual([]);
  });

  it("needs more than a handful of days, however spread out", () => {
    const occasional = onDays(["2026-01-04", "2026-05-11", "2026-09-02"]);
    expect(findPersistentCells(occasional)).toEqual([]);
  });
});

describe("dropPersistent", () => {
  it("removes detections on a masked cell and keeps the rest", () => {
    const industrial = hotspot("2026-08-01T10:00:00Z", 38, 23);
    const fire = hotspot("2026-08-01T10:00:00Z", 39.5, 22);
    expect(
      dropPersistent([industrial, fire], [cellKey(38, 23)]).map((h) => h.id),
    ).toEqual([fire.id]);
  });

  it("is a no-op without a mask", () => {
    const all = [hotspot("2026-08-01T10:00:00Z")];
    expect(dropPersistent(all, [])).toEqual(all);
  });
});

describe("keepConfirmed", () => {
  it("drops a pixel that was hot once and never again", () => {
    const alone = hotspot("2026-03-14T11:00:00Z");
    const elsewhere = hotspot("2026-03-14T11:00:00Z", 40.2, 21.4);
    expect(keepConfirmed([alone, elsewhere])).toEqual([]);
  });

  it("keeps a fire wide enough to light a second pixel", () => {
    const front = [
      hotspot("2026-08-12T11:00:00Z", 38.0, 23.0),
      hotspot("2026-08-12T11:00:00Z", 38.004, 23.004),
    ];
    expect(keepConfirmed(front)).toHaveLength(2);
  });

  it("keeps a fire caught again on a later overpass", () => {
    const seenTwice = [
      hotspot("2026-08-12T11:00:00Z", 38, 23),
      hotspot("2026-08-14T23:00:00Z", 38, 23),
    ];
    expect(keepConfirmed(seenTwice)).toHaveLength(2);
  });

  it("does not let detections a week apart confirm each other", () => {
    const unrelated = [
      hotspot("2026-08-01T11:00:00Z", 38, 23),
      hotspot("2026-08-20T11:00:00Z", 38, 23),
    ];
    expect(keepConfirmed(unrelated)).toEqual([]);
  });

  it("is idempotent, so a baked season survives a re-run", () => {
    const fire = [
      hotspot("2026-08-12T11:00:00Z", 38.0, 23.0),
      hotspot("2026-08-12T11:00:00Z", 38.004, 23.004),
      hotspot("2026-08-13T11:00:00Z", 38.002, 23.002),
    ];
    const once = keepConfirmed(fire);
    expect(keepConfirmed(once)).toEqual(once);
  });
});

describe("toWildfires", () => {
  it("masks with the whole window but returns only the season", () => {
    const flare = onDays(
      [
        "2025-10-04",
        "2025-12-11",
        "2026-02-02",
        "2026-04-19",
        "2026-06-07",
        "2026-08-23",
      ],
      40.7,
      22.949,
    );
    const fire = [
      hotspot("2026-08-12T11:00:00Z", 38.0, 23.0),
      hotspot("2026-08-12T11:00:00Z", 38.004, 23.004),
    ];
    const lastYear = [
      hotspot("2025-09-20T11:00:00Z", 37.0, 22.0),
      hotspot("2025-09-20T11:00:00Z", 37.004, 22.004),
    ];

    const { hotspots, persistentCells } = toWildfires(
      [...flare, ...fire, ...lastYear],
      "2026-01-01",
    );
    expect(persistentCells).toEqual([cellKey(40.7, 22.949)]);
    expect(hotspots.map((h) => h.id).sort()).toEqual(
      fire.map((h) => h.id).sort(),
    );
  });
});
