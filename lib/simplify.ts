export type Position = [number, number];

/**
 * EFFIS ships burnt-area perimeters at full survey precision: a single fire
 * can carry 12k vertices, and a season is ~2 MB. Douglas-Peucker at ~33 m
 * keeps the shape recognisable down to street zoom for a 17x smaller payload.
 */
export const SCAR_TOLERANCE_DEGREES = 0.0003;
const COORDINATE_DECIMALS = 5;

function perpendicularDistance(
  point: Position,
  start: Position,
  end: Position,
): number {
  const [x, y] = point;
  const [x1, y1] = start;
  const [x2, y2] = end;
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(x - x1, y - y1);
  return Math.abs(dy * x - dx * y + x2 * y1 - y2 * x1) / Math.hypot(dx, dy);
}

/**
 * Douglas-Peucker with an explicit stack: recursion would be thousands of
 * frames deep on the biggest rings.
 */
export function simplifyRing(
  ring: readonly Position[],
  tolerance: number,
): Position[] {
  if (ring.length <= 4) return [...ring];

  const keep = new Array<boolean>(ring.length).fill(false);
  keep[0] = true;
  keep[ring.length - 1] = true;
  const segments: [number, number][] = [[0, ring.length - 1]];

  while (segments.length > 0) {
    const [first, last] = segments.pop()!;
    let furthest = -1;
    let maxDistance = 0;
    for (let index = first + 1; index < last; index += 1) {
      const distance = perpendicularDistance(
        ring[index],
        ring[first],
        ring[last],
      );
      if (distance > maxDistance) {
        maxDistance = distance;
        furthest = index;
      }
    }
    if (furthest !== -1 && maxDistance > tolerance) {
      keep[furthest] = true;
      segments.push([first, furthest], [furthest, last]);
    }
  }

  return ring.filter((_, index) => keep[index]);
}

function round(value: number): number {
  const factor = 10 ** COORDINATE_DECIMALS;
  return Math.round(value * factor) / factor;
}

/** Collapses runs of identical points left behind by rounding. */
function dropRepeats(ring: readonly Position[]): Position[] {
  return ring.filter(
    (point, index) =>
      index === 0 ||
      point[0] !== ring[index - 1][0] ||
      point[1] !== ring[index - 1][1],
  );
}

/**
 * Simplifies every ring of a (Multi)Polygon. Rings that collapse below a
 * closed triangle are dropped, as are polygons left without an outer ring.
 */
export function simplifyPolygons(
  polygons: readonly (readonly (readonly Position[])[])[],
  tolerance = SCAR_TOLERANCE_DEGREES,
): Position[][][] {
  const simplified: Position[][][] = [];
  for (const polygon of polygons) {
    const rings: Position[][] = [];
    for (const ring of polygon) {
      const reduced = dropRepeats(
        simplifyRing(ring, tolerance).map(
          ([longitude, latitude]) =>
            [round(longitude), round(latitude)] as Position,
        ),
      );
      if (reduced.length >= 4) rings.push(reduced);
    }
    if (rings.length > 0) simplified.push(rings);
  }
  return simplified;
}
