/** Flat-earth distances, which is plenty over a country the size of Greece. */

export const KM_PER_DEGREE_LAT = 111.32;

export function kmPerDegreeLon(latitude: number): number {
  return KM_PER_DEGREE_LAT * Math.cos((latitude * Math.PI) / 180);
}

interface Point {
  latitude: number;
  longitude: number;
}

export function distanceKm(a: Point, b: Point): number {
  const midLat = (a.latitude + b.latitude) / 2;
  const dx = (a.longitude - b.longitude) * kmPerDegreeLon(midLat);
  const dy = (a.latitude - b.latitude) * KM_PER_DEGREE_LAT;
  return Math.hypot(dx, dy);
}

/**
 * Buckets points into square-ish cells of `sizeKm`, so a neighbour search
 * only has to look at the nine cells around a point.
 */
export function gridIndex<T extends Point>(
  points: readonly T[],
  sizeKm: number,
): Map<string, number[]> {
  const buckets = new Map<string, number[]>();
  points.forEach((point, index) => {
    const key = gridKey(point, sizeKm);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(index);
    else buckets.set(key, [index]);
  });
  return buckets;
}

export function gridKey(point: Point, sizeKm: number): string {
  const row = Math.floor(point.latitude / (sizeKm / KM_PER_DEGREE_LAT));
  const column = Math.floor(
    point.longitude / (sizeKm / kmPerDegreeLon(point.latitude)),
  );
  return `${row}:${column}`;
}

/** The nine cell keys around a point, its own included. */
export function neighbourKeys(point: Point, sizeKm: number): string[] {
  const [row, column] = gridKey(point, sizeKm).split(":").map(Number);
  const keys: string[] = [];
  for (let dRow = -1; dRow <= 1; dRow += 1) {
    for (let dColumn = -1; dColumn <= 1; dColumn += 1) {
      keys.push(`${row + dRow}:${column + dColumn}`);
    }
  }
  return keys;
}
