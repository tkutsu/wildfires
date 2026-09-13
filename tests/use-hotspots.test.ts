import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Hotspot, HotspotsPayload } from "@/lib/types";

vi.mock("@/lib/effis/client", () => ({ fetchGreekHotspotPage: vi.fn() }));

const { fetchGreekHotspotPage } = await import("@/lib/effis/client");
const { useSeasonHotspots } = await import("@/hooks/use-hotspots");
const fetchPage = vi.mocked(fetchGreekHotspotPage);

const MINUTE = 60_000;

function hotspot(
  id: string,
  detectedAt: string,
  latitude = 38,
  longitude = 23,
): Hotspot {
  return { id, latitude, longitude, detectedAt, frp: 5 };
}

// A confirmed fire already in the baked season.
const baked: HotspotsPayload = {
  hotspots: [
    hotspot("b1", "2026-09-12T11:00:00Z"),
    hotspot("b2", "2026-09-12T11:00:00Z", 38.004, 23.004),
  ],
  persistentCells: [],
  observedAt: "2026-09-12T15:30:00Z",
};

let visibility: DocumentVisibilityState = "visible";
function setVisibility(next: DocumentVisibilityState) {
  visibility = next;
  document.dispatchEvent(new Event("visibilitychange"));
}

/** Lets pending promises settle, advancing the fake clock by `ms`. */
async function advance(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-13T12:00:00Z"));
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
  visibility = "visible";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => baked })),
  );
  fetchPage.mockReset();
});

afterEach(() => {
  // Vitest runs without globals here, so Testing Library cannot unmount on its
  // own; a hook left mounted would answer the next test's visibility events.
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useSeasonHotspots", () => {
  it("first reads the days the snapshot lacks, then only new uploads", async () => {
    fetchPage.mockResolvedValue({ hotspots: [], cursor: "2026-09-13 04:11:53" });
    renderHook(() => useSeasonHotspots());
    await advance();

    // Newest baked detection less the two-day linking margin.
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenLastCalledWith({ acquiredSince: "2026-09-10" });

    await advance(15 * MINUTE);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(fetchPage).toHaveBeenLastCalledWith({
      uploadedSince: "2026-09-13 04:11:53",
    });
  });

  it("checks every 15 minutes, not sooner", async () => {
    fetchPage.mockResolvedValue({ hotspots: [], cursor: "2026-09-13 04:11:53" });
    renderHook(() => useSeasonHotspots());
    await advance();
    await advance(14 * MINUTE);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    await advance(MINUTE);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("asks nothing while the tab is hidden, and catches up on return", async () => {
    fetchPage.mockResolvedValue({ hotspots: [], cursor: "2026-09-13 04:11:53" });
    renderHook(() => useSeasonHotspots());
    await advance();

    setVisibility("hidden");
    await advance(2 * 60 * MINUTE);
    expect(fetchPage).toHaveBeenCalledTimes(1);

    // Overdue by now, so the check runs straight away rather than in 15 min.
    setVisibility("visible");
    await advance();
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("does not schedule more if the tab hides while a check is running", async () => {
    let finish: (page: { hotspots: Hotspot[]; cursor: string }) => void = () => {};
    fetchPage
      .mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
      .mockResolvedValue({ hotspots: [], cursor: "2026-09-13 04:11:53" });
    renderHook(() => useSeasonHotspots());
    await advance();
    expect(fetchPage).toHaveBeenCalledTimes(1);

    setVisibility("hidden");
    finish({ hotspots: [], cursor: "2026-09-13 04:11:53" });
    await advance(2 * 60 * MINUTE);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("does not check early when the tab returns before a check is due", async () => {
    fetchPage.mockResolvedValue({ hotspots: [], cursor: "2026-09-13 04:11:53" });
    renderHook(() => useSeasonHotspots());
    await advance();

    setVisibility("hidden");
    await advance(5 * MINUTE);
    setVisibility("visible");
    await advance(9 * MINUTE);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    await advance(MINUTE);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("keeps the cursor through a failed check", async () => {
    fetchPage
      .mockResolvedValueOnce({ hotspots: [], cursor: "2026-09-13 04:11:53" })
      .mockRejectedValueOnce(new Error("EFFIS cut the response short"))
      .mockResolvedValue({ hotspots: [], cursor: undefined });
    renderHook(() => useSeasonHotspots());
    await advance();
    await advance(15 * MINUTE);
    await advance(15 * MINUTE);

    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(fetchPage).toHaveBeenLastCalledWith({
      uploadedSince: "2026-09-13 04:11:53",
    });
  });

  it("shows a fire published late, once it is confirmed", async () => {
    fetchPage
      .mockResolvedValueOnce({ hotspots: [], cursor: "2026-09-13 04:11:53" })
      .mockResolvedValueOnce({
        // Acquired this morning, published only now.
        hotspots: [
          hotspot("n1", "2026-09-13T00:40:00Z", 39.5, 22.1),
          hotspot("n2", "2026-09-13T00:40:00Z", 39.503, 22.103),
        ],
        cursor: "2026-09-13 14:04:52",
      })
      .mockResolvedValue({ hotspots: [], cursor: undefined });
    const { result } = renderHook(() => useSeasonHotspots());
    await advance();
    expect(result.current.hotspots.map((h) => h.id).sort()).toEqual(["b1", "b2"]);

    await advance(15 * MINUTE);
    expect(result.current.hotspots.map((h) => h.id).sort()).toEqual([
      "b1",
      "b2",
      "n1",
      "n2",
    ]);

    // A later quiet check keeps what it has rather than dropping it.
    await advance(15 * MINUTE);
    expect(result.current.hotspots).toHaveLength(4);
  });
});
