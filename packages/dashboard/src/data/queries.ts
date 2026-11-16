import { lit, query } from './db';

export type Range = '24h' | '7d' | '30d' | '90d';
export const RANGE_DAYS: Record<Range, number> = { '24h': 1, '7d': 7, '30d': 30, '90d': 90 };

export interface Filters {
  app_version?: string;
  platform?: string;
  variant?: string;
  feature?: string;
  /** Extra key=value filter on props or context. */
  prop?: { key: string; value: string };
}

/** Periods are anchored on the newest event, so imported or old data still shows. */
async function anchor(): Promise<Date> {
  const [r] = await query<{ t: Date | null }>('SELECT max(ts) AS t FROM events');
  return r?.t ? new Date(r.t) : new Date();
}

export function keyExpr(key: string): string {
  const builtin = ['app_version', 'platform', 'variant', 'feature', 'name'];
  if (builtin.includes(key)) return key;
  return `coalesce(props->>${lit(key)}, context->>${lit(key)})`;
}

function where(from: Date, to: Date, f: Filters, extra: string[] = []): string {
  const parts = [`ts > TIMESTAMP ${lit(from.toISOString().replace('T', ' ').replace('Z', ''))}`, `ts <= TIMESTAMP ${lit(to.toISOString().replace('T', ' ').replace('Z', ''))}`];
  for (const k of ['app_version', 'platform', 'variant', 'feature'] as const) {
    if (f[k]) parts.push(`${k} = ${lit(f[k]!)}`);
  }
  if (f.prop?.key && f.prop.value !== undefined) parts.push(`${keyExpr(f.prop.key)} = ${lit(f.prop.value)}`);
  return 'WHERE ' + [...parts, ...extra].join(' AND ');
}

export interface Period {
  from: Date;
  to: Date;
  prevFrom: Date;
  days: number;
}

export async function period(range: Range): Promise<Period> {
  const to = await anchor();
  const days = RANGE_DAYS[range];
  const from = new Date(to.getTime() - days * 86400_000);
  const prevFrom = new Date(from.getTime() - days * 86400_000);
  return { from, to, prevFrom, days };
}

export async function distinctValues(col: 'app_version' | 'platform' | 'variant' | 'feature'): Promise<string[]> {
  const rows = await query<{ v: string }>(`SELECT ${col} AS v, count(*) n FROM events WHERE ${col} IS NOT NULL GROUP BY 1 ORDER BY n DESC LIMIT 50`);
  return rows.map((r) => r.v);
}

export interface Kpis {
  events: number;
  users: number;
  prevEvents: number;
  prevUsers: number;
  topVersion: string | null;
  topVersionShare: number;
}

export async function kpis(p: Period, f: Filters): Promise<Kpis> {
  const [cur] = await query<{ e: number; u: number }>(`SELECT count(*) e, count(DISTINCT uid) u FROM events ${where(p.from, p.to, f)}`);
  const [prev] = await query<{ e: number; u: number }>(`SELECT count(*) e, count(DISTINCT uid) u FROM events ${where(p.prevFrom, p.from, f)}`);
  const [top] = await query<{ v: string; u: number }>(
    `SELECT app_version v, count(DISTINCT uid) u FROM events ${where(p.from, p.to, f, ['app_version IS NOT NULL'])} GROUP BY 1 ORDER BY u DESC LIMIT 1`
  );
  return {
    events: cur.e,
    users: cur.u,
    prevEvents: prev.e,
    prevUsers: prev.u,
    topVersion: top?.v ?? null,
    topVersionShare: top && cur.u ? top.u / cur.u : 0,
  };
}

export interface SeriesPoint {
  day: Date;
  key: string;
  n: number;
}

/**
 * Daily counts split by a key. Keeps the `top` most frequent values; the rest become "other".
 * metric: events (count), users (distinct uid).
 */
export async function dailyBy(p: Period, f: Filters, key: string, opts: { event?: string; top?: number; metric?: 'events' | 'users' } = {}): Promise<{ keys: string[]; points: SeriesPoint[] }> {
  const k = keyExpr(key);
  const extra = opts.event ? [`name = ${lit(opts.event)}`] : [];
  const w = where(p.from, p.to, f, extra);
  const top = await query<{ v: string }>(`SELECT coalesce(${k}, '(none)') v, count(*) n FROM events ${w} GROUP BY 1 ORDER BY n DESC LIMIT ${opts.top ?? 3}`);
  const keys = top.map((r) => String(r.v));
  const inList = keys.length ? keys.map(lit).join(',') : "''";
  const agg = opts.metric === 'users' ? 'count(DISTINCT uid)' : 'count(*)';
  const bucket = p.days <= 1 ? 'hour' : 'day';
  const points = await query<SeriesPoint>(`
    SELECT date_trunc('${bucket}', ts) AS day,
      CASE WHEN coalesce(${k}, '(none)') IN (${inList}) THEN coalesce(${k}, '(none)') ELSE 'other' END AS key,
      ${agg} AS n
    FROM events ${w} GROUP BY 1, 2 ORDER BY 1`);
  const hasOther = points.some((x) => x.key === 'other');
  return { keys: hasOther ? [...keys, 'other'] : keys, points: points.map((x) => ({ ...x, day: new Date(x.day) })) };
}

export interface TopEvent {
  name: string;
  total: number;
  users: number;
  prev: number;
  keys: string;
}

export async function topEvents(p: Period, f: Filters, limit = 20): Promise<TopEvent[]> {
  const rows = await query<TopEvent>(`
    WITH cur AS (
      SELECT name, count(*) total, count(DISTINCT uid) users,
        array_to_string(list_sort(list_distinct(flatten(list(json_keys(props))))), ', ') AS keys
      FROM events ${where(p.from, p.to, f)} GROUP BY name
    ), prev AS (
      SELECT name, count(*) prev FROM events ${where(p.prevFrom, p.from, f)} GROUP BY name
    )
    SELECT cur.name, total, users, coalesce(prev, 0) prev, coalesce(keys, '') keys
    FROM cur LEFT JOIN prev USING (name) ORDER BY total DESC LIMIT ${limit}`);
  return rows;
}

export async function eventNames(): Promise<string[]> {
  const rows = await query<{ name: string }>('SELECT name, count(*) n FROM events GROUP BY 1 ORDER BY n DESC');
  return rows.map((r) => r.name);
}

/** Keys that can be used to split an event: built-ins, its props, and custom context keys. */
export async function breakdownKeys(event: string): Promise<string[]> {
  const rows = await query<{ k: string }>(`
    SELECT DISTINCT unnest(json_keys(props)) k FROM (SELECT props FROM events WHERE name = ${lit(event)} LIMIT 5000)
    UNION
    SELECT DISTINCT unnest(json_keys(context)) k FROM (SELECT context FROM events WHERE name = ${lit(event)} LIMIT 5000)`);
  const skip = new Set(['app_version', 'platform', 'variant', 'feature', 'build', 'sdk_version', 'os_version', 'device_model', 'locale', 'ota']);
  const extra = rows.map((r) => r.k).filter((k) => !skip.has(k)).sort();
  return ['app_version', 'variant', 'platform', 'feature', ...extra, 'build', 'os_version', 'device_model', 'locale'];
}

export async function eventSummary(p: Period, f: Filters, event: string) {
  const [r] = await query<{ e: number; u: number }>(`SELECT count(*) e, count(DISTINCT uid) u FROM events ${where(p.from, p.to, f, [`name = ${lit(event)}`])}`);
  return { events: r.e, users: r.u };
}

export async function breakdownTable(p: Period, f: Filters, event: string, key: string) {
  const k = keyExpr(key);
  return query<{ v: string; e: number; u: number }>(`
    SELECT coalesce(${k}, '(none)') v, count(*) e, count(DISTINCT uid) u
    FROM events ${where(p.from, p.to, f, [`name = ${lit(event)}`])} GROUP BY 1 ORDER BY e DESC LIMIT 25`);
}

export async function recentEvents(event: string, limit = 12) {
  return query<{ ts: Date; props: string; context: string; user_id: string | null }>(
    `SELECT ts, CAST(props AS VARCHAR) props, CAST(context AS VARCHAR) context, user_id FROM events WHERE name = ${lit(event)} ORDER BY ts DESC LIMIT ${limit}`
  );
}

// --- Experiments -----------------------------------------------------------------

export interface Experiment {
  id: string;
  name: string;
  exposure: string;
  goal: string;
  variantKey: string;
  control: string;
  /** ISO dates; empty = whole data. */
  start?: string;
  end?: string;
  versions?: string[];
}

function expWhere(e: Experiment): string {
  const parts = ['TRUE'];
  if (e.start) parts.push(`ts >= TIMESTAMP ${lit(e.start)}`);
  if (e.end) parts.push(`ts < TIMESTAMP ${lit(e.end)} + INTERVAL 1 DAY`);
  if (e.versions?.length) parts.push(`app_version IN (${e.versions.map(lit).join(',')})`);
  return parts.join(' AND ');
}

function exposuresCte(e: Experiment): string {
  const vk = keyExpr(e.variantKey);
  return `
    exposures AS (
      SELECT uid, min(ts) first_ts, arg_min(${vk}, ts) v, arg_min(app_version, ts) ver
      FROM events WHERE name = ${lit(e.exposure)} AND ${vk} IS NOT NULL AND ${expWhere(e)}
      GROUP BY uid
    ),
    conv AS (
      SELECT x.uid, min(g.ts) conv_ts FROM exposures x
      JOIN events g ON g.uid = x.uid AND g.name = ${lit(e.goal)} AND g.ts >= x.first_ts AND ${expWhere(e).replace(/\bts\b/g, 'g.ts').replace(/\bapp_version\b/g, 'g.app_version')}
      GROUP BY x.uid
    )`;
}

export async function experimentArms(e: Experiment) {
  return query<{ v: string; exposed: number; converted: number }>(`
    WITH ${exposuresCte(e)}
    SELECT v, count(*) exposed, count(conv.uid) converted
    FROM exposures LEFT JOIN conv USING (uid) GROUP BY v ORDER BY v`);
}

export async function experimentByVersion(e: Experiment) {
  return query<{ ver: string; v: string; exposed: number; converted: number }>(`
    WITH ${exposuresCte(e)}
    SELECT coalesce(ver, '(none)') ver, v, count(*) exposed, count(conv.uid) converted
    FROM exposures LEFT JOIN conv USING (uid) GROUP BY 1, 2 ORDER BY 1 DESC, 2`);
}

/** Cumulative conversion per day of exposure, per variant. */
export async function experimentDaily(e: Experiment) {
  const rows = await query<{ day: Date; v: string; exposed: number; converted: number }>(`
    WITH ${exposuresCte(e)}
    SELECT date_trunc('day', first_ts) AS day, v, count(*) exposed, count(conv.uid) converted
    FROM exposures LEFT JOIN conv USING (uid) GROUP BY 1, 2 ORDER BY 1`);
  const acc: Record<string, { e: number; c: number }> = {};
  return rows.map((r) => {
    const a = (acc[r.v] ??= { e: 0, c: 0 });
    a.e += r.exposed;
    a.c += r.converted;
    return { day: new Date(r.day), v: r.v, rate: a.e ? a.c / a.e : 0, exposed: a.e };
  });
}

export async function experimentDailyExposures(e: Experiment): Promise<number> {
  const [r] = await query<{ n: number; d: number }>(`
    WITH ${exposuresCte(e)}
    SELECT count(*) n, greatest(1, date_diff('day', min(first_ts), max(first_ts)) + 1) d FROM exposures`);
  return r && r.d ? r.n / r.d : 0;
}
