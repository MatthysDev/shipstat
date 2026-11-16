import { lit, query } from './db';
import { bucket, keyExpr, metricExpr, where, type FilterKey, type Filters, type Metric, type Period } from './sql';

export interface SeriesPoint {
  day: Date;
  key: string;
  n: number;
}

export interface Series {
  keys: string[];
  points: SeriesPoint[];
}

export async function distinctValues(col: FilterKey): Promise<string[]> {
  const rows = await query<{ v: string }>(`SELECT ${col} AS v, count(*) n FROM events WHERE ${col} IS NOT NULL GROUP BY 1 ORDER BY n DESC LIMIT 50`);
  return rows.map((r) => r.v);
}

export async function eventNames(): Promise<string[]> {
  const rows = await query<{ name: string }>('SELECT name, count(*) n FROM events GROUP BY 1 ORDER BY n DESC');
  return rows.map((r) => r.name);
}

export interface Totals {
  value: number;
  prev: number;
}

/** One number for the period and the one before it. */
export async function total(p: Period, f: Filters, metric: Metric, event?: string): Promise<Totals> {
  const extra = event ? [`name = ${lit(event)}`] : [];
  const m = metricExpr(metric);
  const [cur] = await query<{ v: number }>(`SELECT ${m} v FROM events ${where(p.from, p.to, f, extra)}`);
  const [prev] = await query<{ v: number }>(`SELECT ${m} v FROM events ${where(p.prevFrom, p.from, f, extra)}`);
  return { value: cur?.v ?? 0, prev: prev?.v ?? 0 };
}

/**
 * Counts per hour or day, optionally split by a key. Keeps the `top` most frequent
 * values and groups the rest as "other". Without a key, the single series is "total".
 */
export async function series(p: Period, f: Filters, opts: { key?: string; event?: string; top?: number; metric?: Metric } = {}): Promise<Series> {
  const extra = opts.event ? [`name = ${lit(opts.event)}`] : [];
  const w = where(p.from, p.to, f, extra);
  const m = metricExpr(opts.metric ?? 'events');
  const unit = bucket(p);
  if (!opts.key) {
    const points = await query<SeriesPoint>(`SELECT date_trunc('${unit}', ts) AS day, 'total' AS key, ${m} AS n FROM events ${w} GROUP BY 1 ORDER BY 1`);
    return { keys: ['total'], points: points.map((x) => ({ ...x, day: new Date(x.day) })) };
  }
  const k = keyExpr(opts.key);
  const top = await query<{ v: string }>(`SELECT coalesce(${k}, '(none)') v, count(*) n FROM events ${w} GROUP BY 1 ORDER BY n DESC LIMIT ${opts.top ?? 4}`);
  const keys = top.map((r) => String(r.v));
  const inList = keys.length ? keys.map(lit).join(',') : "''";
  const points = await query<SeriesPoint>(`
    SELECT date_trunc('${unit}', ts) AS day,
      CASE WHEN coalesce(${k}, '(none)') IN (${inList}) THEN coalesce(${k}, '(none)') ELSE 'other' END AS key,
      ${m} AS n
    FROM events ${w} GROUP BY 1, 2 ORDER BY 1`);
  const hasOther = points.some((x) => x.key === 'other');
  return { keys: hasOther ? [...keys, 'other'] : keys, points: points.map((x) => ({ ...x, day: new Date(x.day) })) };
}

export interface BreakdownRow {
  value: string;
  n: number;
  events: number;
  users: number;
}

/** Values of a key with events, users and the chosen metric. */
export async function breakdown(p: Period, f: Filters, key: string, opts: { event?: string; metric?: Metric; limit?: number } = {}): Promise<BreakdownRow[]> {
  const extra = opts.event ? [`name = ${lit(opts.event)}`] : [];
  const k = keyExpr(key);
  return query<BreakdownRow>(`
    SELECT coalesce(${k}, '(none)') AS value, ${metricExpr(opts.metric ?? 'events')} AS n, count(*) AS events, count(DISTINCT uid) AS users
    FROM events ${where(p.from, p.to, f, extra)} GROUP BY 1 ORDER BY n DESC LIMIT ${opts.limit ?? 25}`);
}

export interface TopEvent {
  name: string;
  total: number;
  users: number;
  prev: number;
  keys: string;
}

export async function topEvents(p: Period, f: Filters, limit = 20): Promise<TopEvent[]> {
  return query<TopEvent>(`
    WITH cur AS (
      SELECT name, count(*) total, count(DISTINCT uid) users,
        array_to_string(list_sort(list_distinct(flatten(list(json_keys(props))))), ', ') AS keys
      FROM events ${where(p.from, p.to, f)} GROUP BY name
    ), prev AS (
      SELECT name, count(*) prev FROM events ${where(p.prevFrom, p.from, f)} GROUP BY name
    )
    SELECT cur.name, total, users, coalesce(prev, 0) prev, coalesce(keys, '') keys
    FROM cur LEFT JOIN prev USING (name) ORDER BY total DESC LIMIT ${limit}`);
}

export async function topVersion(p: Period, f: Filters): Promise<{ version: string | null; share: number }> {
  const [all] = await query<{ u: number }>(`SELECT count(DISTINCT uid) u FROM events ${where(p.from, p.to, f)}`);
  const [top] = await query<{ v: string; u: number }>(`SELECT app_version v, count(DISTINCT uid) u FROM events ${where(p.from, p.to, f, ['app_version IS NOT NULL'])} GROUP BY 1 ORDER BY u DESC LIMIT 1`);
  return { version: top?.v ?? null, share: top && all?.u ? top.u / all.u : 0 };
}

/** Keys that can split an event: built-ins first, then its own props and custom context keys. */
export async function breakdownKeys(event?: string): Promise<string[]> {
  const scope = event ? `WHERE name = ${lit(event)}` : '';
  const rows = await query<{ k: string }>(`
    SELECT DISTINCT unnest(json_keys(props)) k FROM (SELECT props FROM events ${scope} LIMIT 5000)
    UNION
    SELECT DISTINCT unnest(json_keys(context)) k FROM (SELECT context FROM events ${scope} LIMIT 5000)`);
  const auto = new Set(['app_version', 'platform', 'variant', 'feature', 'build', 'sdk_version', 'os_version', 'device_model', 'locale', 'ota']);
  const custom = rows.map((r) => r.k).filter((k) => !auto.has(k)).sort();
  return ['app_version', 'variant', 'platform', 'feature', ...custom, 'build', 'os_version', 'device_model', 'locale'];
}

export async function recentEvents(event: string, limit = 12) {
  return query<{ ts: Date; props: string; context: string }>(
    `SELECT ts, CAST(props AS VARCHAR) props, CAST(context AS VARCHAR) context FROM events WHERE name = ${lit(event)} ORDER BY ts DESC LIMIT ${limit}`
  );
}

export interface FunnelStep {
  step: number;
  name: string;
  group: string;
  users: number;
}

/**
 * Ordered funnel: users who did step 1, then step 2 after it, and so on, within the period.
 * Optional split by a key read on the first step.
 */
export async function funnel(p: Period, f: Filters, steps: string[], splitKey?: string): Promise<FunnelStep[]> {
  if (!steps.length) return [];
  // Step CTEs only expose (uid, t, g), so unqualified filter columns always resolve to `e`.
  const scope = (name: string) => where(p.from, p.to, f, [`e.name = ${lit(name)}`]);
  const group = splitKey ? `coalesce(${keyExpr(splitKey)}, '(none)')` : `'all'`;
  const ctes = [`s1 AS (SELECT uid, min(ts) t, arg_min(${group}, ts) g FROM events e ${scope(steps[0])} GROUP BY uid)`];
  for (let i = 1; i < steps.length; i++) {
    ctes.push(`s${i + 1} AS (
      SELECT e.uid, min(e.ts) t, any_value(s${i}.g) g
      FROM events e JOIN s${i} ON e.uid = s${i}.uid AND e.ts >= s${i}.t
      ${scope(steps[i])} GROUP BY e.uid)`);
  }
  const counts = steps.map((name, i) => `SELECT ${i + 1} AS step, ${lit(name)} AS name, g AS grp, count(*) AS users FROM s${i + 1} GROUP BY g`).join('\nUNION ALL ');
  const rows = await query<{ step: number; name: string; grp: string; users: number }>(`WITH ${ctes.join(',\n')} SELECT * FROM (${counts}) ORDER BY grp, step`);
  return rows.map((r) => ({ step: r.step, name: r.name, group: r.grp, users: r.users }));
}
