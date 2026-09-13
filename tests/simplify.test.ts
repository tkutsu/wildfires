import { describe, expect, it } from "vitest";
import {
  simplifyPolygons,
  simplifyRing,
  type Position,
} from "@/lib/simplify";

describe("simplifyRing", () => {
  it("keeps short rings untouched", () => {
    const ring: Position[] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 0],
    ];
    expect(simplifyRing(ring, 0.1)).toEqual(ring);
  });

  it("drops vertices that sit on a straight line", () => {
    const ring: Position[] = [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
      [3, 3],
      [0, 0],
    ];
    const simplified = simplifyRing(ring, 0.01);
    expect(simplified).toEqual([
      [0, 0],
      [3, 0],
      [3, 3],
      [0, 0],
    ]);
  });

  it("keeps a vertex that deviates beyond the tolerance", () => {
    const ring: Position[] = [
      [0, 0],
      [1, 0.5],
      [2, 0],
      [2, 2],
      [0, 0],
    ];
    expect(simplifyRing(ring, 0.1)).toContainEqual([1, 0.5]);
    expect(simplifyRing(ring, 1)).not.toContainEqual([1, 0.5]);
  });

  it("stays closed, so the ring remains a valid polygon", () => {
    const ring: Position[] = [
      [0, 0],
      [1, 0.001],
      [2, 0],
      [2, 2],
      [0, 2],
      [0, 0],
    ];
    const simplified = simplifyRing(ring, 0.5);
    expect(simplified[0]).toEqual(simplified.at(-1));
  });

  it("handles rings far larger than the call stack allows recursively", () => {
    // A circle of 20k points: plain recursion would overflow.
    const ring: Position[] = Array.from({ length: 20_000 }, (_, index) => {
      const angle = (index / 20_000) * Math.PI * 2;
      return [Math.cos(angle), Math.sin(angle)] as Position;
    });
    ring.push(ring[0]);
    const simplified = simplifyRing(ring, 0.01);
    expect(simplified.length).toBeGreaterThan(4);
    expect(simplified.length).toBeLessThan(ring.length / 10);
  });
});

describe("simplifyPolygons", () => {
  it("rounds coordinates and drops collapsed rings", () => {
    const polygons: Position[][][] = [
      [
        [
          [20.123456789, 39.987654321],
          [20.2, 39.98],
          [20.2, 40.1],
          [20.123456789, 39.987654321],
        ],
        // A hole so small it cannot survive simplification.
        [
          [20.15, 40.0],
          [20.1500001, 40.0],
          [20.15, 40.0000001],
          [20.15, 40.0],
        ],
      ],
    ];
    const [polygon] = simplifyPolygons(polygons, 0.001);
    expect(polygon).toHaveLength(1);
    expect(polygon[0][0]).toEqual([20.12346, 39.98765]);
  });

  it("drops polygons whose every ring collapses", () => {
    const polygons: Position[][][] = [
      [
        [
          [20, 40],
          [20, 40],
          [20, 40],
        ],
      ],
    ];
    expect(simplifyPolygons(polygons, 0.001)).toEqual([]);
  });
});
