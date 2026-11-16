import type { SeriesPoint } from '../../data/queries';

/** Rounds an axis maximum up to 1, 2, 2.5 or 5 × a power of ten. */
export function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

export function buckets(points: SeriesPoint[]): number[] {
  return [...new Set(points.map((p) => p.day.getTime()))].sort((a, b) => a - b);
}

/** Value lookup by bucket time and series key. */
export function grid(points: SeriesPoint[]) {
  const m = new Map<string, number>();
  for (const p of points) m.set(`${p.day.getTime()}|${p.key}`, p.n);
  return (t: number, key: string) => m.get(`${t}|${key}`) ?? 0;
}

/** Up to 5 evenly spaced label positions. */
export function labelIndexes(n: number): number[] {
  if (n <= 6) return [...Array(n).keys()];
  return [...new Set([0, 1, 2, 3, 4].map((k) => Math.round((k * (n - 1)) / 4)))];
}
