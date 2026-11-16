import { lit, query } from './db';

export type Range = '24h' | '7d' | '30d' | '90d';
export const RANGES: Range[] = ['24h', '7d', '30d', '90d'];
const RANGE_DAYS: Record<Range, number> = { '24h': 1, '7d': 7, '30d': 30, '90d': 90 };

/** Columns materialized at load time; anything else is read from props, then context. */
export const BUILTIN_KEYS = ['name', 'app_version', 'platform', 'variant', 'feature'] as const;
export type FilterKey = 'app_version' | 'platform' | 'variant' | 'feature';
export const FILTER_KEYS: FilterKey[] = ['app_version', 'platform', 'variant', 'feature'];

export type Filters = Partial<Record<FilterKey, string>>;

export type Metric = 'events' | 'users' | 'per_user';

export interface Period {
  from: Date;
  to: Date;
  prevFrom: Date;
  days: number;
}

/** SQL expression for a key: a materialized column, or props then context JSON. */
export function keyExpr(key: string): string {
  if ((BUILTIN_KEYS as readonly string[]).includes(key)) return key;
  return `coalesce(props->>${lit(key)}, context->>${lit(key)})`;
}

export function metricExpr(m: Metric): string {
  if (m === 'users') return 'count(DISTINCT uid)';
  if (m === 'per_user') return 'count(*)::DOUBLE / greatest(count(DISTINCT uid), 1)';
  return 'count(*)';
}

const ts = (d: Date) => `TIMESTAMP ${lit(d.toISOString().replace('T', ' ').replace('Z', ''))}`;

/** WHERE clause for a time window, filters and extra conditions. */
export function where(from: Date, to: Date, f: Filters, extra: string[] = []): string {
  const parts = [`ts > ${ts(from)}`, `ts <= ${ts(to)}`];
  for (const k of FILTER_KEYS) if (f[k]) parts.push(`${k} = ${lit(f[k]!)}`);
  return 'WHERE ' + [...parts, ...extra].join(' AND ');
}

/** Periods end at the newest event, so imported or old data still shows. */
export async function period(range: Range): Promise<Period> {
  const [r] = await query<{ t: Date | null }>('SELECT max(ts) AS t FROM events');
  const to = r?.t ? new Date(r.t) : new Date();
  const days = RANGE_DAYS[range];
  const from = new Date(to.getTime() - days * 86400_000);
  return { from, to, prevFrom: new Date(from.getTime() - days * 86400_000), days };
}

export function bucket(p: Period): 'hour' | 'day' {
  return p.days <= 1 ? 'hour' : 'day';
}
