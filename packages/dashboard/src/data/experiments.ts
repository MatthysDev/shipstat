import { lit, query } from './db';
import { keyExpr } from './sql';

export interface Experiment {
  id: string;
  name: string;
  /** Event that exposes a user to the test (e.g. paywall_viewed). */
  exposure: string;
  /** Event counted as a conversion when it happens after the first exposure. */
  goal: string;
  /** Context or prop key holding the variant. */
  variantKey: string;
  control: string;
  /** YYYY-MM-DD, inclusive; empty = all loaded data. */
  start?: string;
  end?: string;
  versions?: string[];
}

export function isExperiment(v: unknown): v is Experiment {
  const e = v as Experiment;
  return !!e && typeof e.id === 'string' && typeof e.exposure === 'string' && typeof e.goal === 'string' && typeof e.variantKey === 'string' && typeof e.control === 'string';
}

function scope(e: Experiment, alias = ''): string {
  const a = alias ? `${alias}.` : '';
  const parts = ['TRUE'];
  if (e.start) parts.push(`${a}ts >= TIMESTAMP ${lit(e.start)}`);
  if (e.end) parts.push(`${a}ts < TIMESTAMP ${lit(e.end)} + INTERVAL 1 DAY`);
  if (e.versions?.length) parts.push(`${a}app_version IN (${e.versions.map(lit).join(',')})`);
  return parts.join(' AND ');
}

/** One row per exposed user (variant and version at first exposure) and whether they converted. */
function usersCte(e: Experiment): string {
  const vk = keyExpr(e.variantKey);
  return `
    exposures AS (
      SELECT uid, min(ts) first_ts, arg_min(${vk}, ts) v, arg_min(app_version, ts) ver
      FROM events WHERE name = ${lit(e.exposure)} AND ${vk} IS NOT NULL AND ${scope(e)}
      GROUP BY uid
    ),
    conv AS (
      SELECT x.uid FROM exposures x
      JOIN events g ON g.uid = x.uid AND g.name = ${lit(e.goal)} AND g.ts >= x.first_ts AND ${scope(e, 'g')}
      GROUP BY x.uid
    ),
    users AS (
      SELECT exposures.*, conv.uid IS NOT NULL AS converted FROM exposures LEFT JOIN conv USING (uid)
    )`;
}

export interface ArmRow {
  v: string;
  exposed: number;
  converted: number;
}

export async function arms(e: Experiment): Promise<ArmRow[]> {
  return query<ArmRow>(`WITH ${usersCte(e)} SELECT v, count(*)::BIGINT exposed, count_if(converted)::BIGINT converted FROM users GROUP BY v ORDER BY v`);
}

export async function armsByVersion(e: Experiment): Promise<(ArmRow & { ver: string })[]> {
  return query(`WITH ${usersCte(e)} SELECT coalesce(ver, '(none)') ver, v, count(*)::BIGINT exposed, count_if(converted)::BIGINT converted FROM users GROUP BY 1, 2 ORDER BY 1 DESC, 2`);
}

/** Cumulative conversion rate by day of first exposure, per variant. */
export async function cumulative(e: Experiment): Promise<{ day: Date; v: string; rate: number }[]> {
  const rows = await query<{ day: Date; v: string; exposed: number; converted: number }>(`
    WITH ${usersCte(e)}
    SELECT date_trunc('day', first_ts) AS day, v, count(*)::BIGINT exposed, count_if(converted)::BIGINT converted FROM users GROUP BY 1, 2 ORDER BY 1`);
  const acc: Record<string, { e: number; c: number }> = {};
  return rows.map((r) => {
    const a = (acc[r.v] ??= { e: 0, c: 0 });
    a.e += r.exposed;
    a.c += r.converted;
    return { day: new Date(r.day), v: r.v, rate: a.e ? a.c / a.e : 0 };
  });
}

/** Average new exposures per day, to estimate how long a test still needs. */
export async function exposuresPerDay(e: Experiment): Promise<number> {
  const [r] = await query<{ n: number; d: number }>(`
    WITH ${usersCte(e)}
    SELECT count(*) n, greatest(1, date_diff('day', min(first_ts), max(first_ts)) + 1) d FROM users`);
  return r?.d ? r.n / r.d : 0;
}
