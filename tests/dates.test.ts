import { describe, expect, it } from "vitest";
import { toUtcDay } from "@/lib/dates";

describe("toUtcDay", () => {
  it("formats in UTC regardless of local offset", () => {
    expect(toUtcDay(new Date("2026-08-31T23:30:00Z"))).toBe("2026-08-31");
  });

  it("does not roll back across the year boundary", () => {
    expect(toUtcDay(new Date("2026-01-01T00:00:00Z"))).toBe("2026-01-01");
  });
});
