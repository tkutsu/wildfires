import { describe, expect, it } from "vitest";
import {
  averageByDay,
  compareWithHistory,
  dayOfYear,
  hectaresByDay,
} from "@/lib/season-history";
import type { SeasonHistory } from "@/lib/types";

const history: SeasonHistory[] = [
  // A quiet season and a catastrophic one, so the average sits between them.
  { year: 2024, steps: [[150, 1_000], [200, 4_000], [250, 10_000]] },
  { year: 2025, steps: [[150, 5_000], [200, 60_000], [250, 90_000]] },
];

describe("dayOfYear", () => {
  it("counts from 1 on new year's day", () => {
    expect(dayOfYear("2026-01-01")).toBe(1);
  });

  it("handles a leap year", () => {
    expect(dayOfYear("2024-12-31")).toBe(366);
    expect(dayOfYear("2026-12-31")).toBe(365);
  });
});

describe("hectaresByDay", () => {
  it("is zero before the first fire of the year", () => {
    expect(hectaresByDay(history[0].steps, 100)).toBe(0);
  });

  it("holds the last total between fires", () => {
    expect(hectaresByDay(history[0].steps, 199)).toBe(1_000);
  });

  it("includes a fire that started that very day", () => {
    expect(hectaresByDay(history[0].steps, 200)).toBe(4_000);
  });

  it("ends on the season total", () => {
    expect(hectaresByDay(history[0].steps, 365)).toBe(10_000);
  });
});

describe("averageByDay", () => {
  it("averages the seasons at the same point in the year", () => {
    expect(averageByDay(history, 200)).toBe(32_000);
  });

  it("is zero without any history", () => {
    expect(averageByDay([], 200)).toBe(0);
  });
});

describe("compareWithHistory", () => {
  it("reads as a share of the average for a mild year", () => {
    const result = compareWithHistory(history, "2026-07-19", 16_000);
    expect(result?.label).toBe("50% of the 2024–2025 average");
  });

  it("switches to a multiple once the year is the worse one", () => {
    const result = compareWithHistory(history, "2026-07-19", 64_000);
    expect(result?.ratio).toBe(2);
    expect(result?.label).toBe("2.0× the 2024–2025 average");
  });

  it("says nothing in January, where the average is still noise", () => {
    expect(compareWithHistory(history, "2026-01-20", 40)).toBeNull();
  });

  it("says nothing without any mapped seasons", () => {
    expect(compareWithHistory([], "2026-07-19", 16_000)).toBeNull();
  });

  it("refuses an average with a season missing from the middle", () => {
    // 2019-2021 with 2020 lost: the span would claim a season it lacks.
    const gapped: SeasonHistory[] = [
      { year: 2019, steps: [[150, 5_000]] },
      { year: 2021, steps: [[150, 9_000]] },
    ];
    expect(compareWithHistory(gapped, "2026-07-19", 7_000)).toBeNull();
  });
});
