import type { Context, Props, ShipstatConfig } from './Shipstat.types';

const NAME_RE = /^[A-Za-z0-9_.:\-$ ]{1,128}$/;

function isPrimitive(v: unknown): boolean {
  return v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));
}

/** Returns a list of problems; empty when valid. Only run in development. */
export function checkEvent(name: unknown, props: unknown): string[] {
  const errors: string[] = [];
  if (typeof name !== 'string' || !NAME_RE.test(name)) {
    errors.push(`event name must be 1-128 chars of letters, digits, _ . : - $ or space (got ${JSON.stringify(name)})`);
  }
  if (props != null) errors.push(...checkFlat(props, 'props', true));
  return errors;
}

export function checkContext(ctx: unknown): string[] {
  return checkFlat(ctx, 'context', false);
}

function checkFlat(obj: unknown, label: string, allowArrays: boolean): string[] {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return [`${label} must be a plain object`];
  const errors: string[] = [];
  for (const [k, v] of Object.entries(obj as Props | Context)) {
    if (isPrimitive(v)) continue;
    if (allowArrays && Array.isArray(v) && v.every(isPrimitive)) continue;
    errors.push(`${label}.${k} must be a string, number, boolean or null${allowArrays ? ' (or an array of them)' : ''}`);
  }
  return errors;
}

export function normalizeConfig(config: ShipstatConfig) {
  if (!config || typeof config.endpoint !== 'string' || !/^https?:\/\//.test(config.endpoint)) {
    throw new Error('[shipstat] init() needs an http(s) endpoint');
  }
  const pos = (v: number | undefined, d: number) => (typeof v === 'number' && v > 0 ? Math.floor(v) : d);
  return {
    endpoint: config.endpoint,
    headers: config.headers ?? {},
    flushAt: pos(config.flushAt, 50),
    flushIntervalMs: pos(config.flushIntervalMs, 30_000),
    maxQueueSize: pos(config.maxQueueSize, 10_000),
    enabled: config.enabled ?? true,
    debug: config.debug ?? false,
    compress: config.compress ?? true,
  };
}

/** Keeps only valid primitives, in production too: native JSON writers reject NaN and Infinity. */
export function cleanContext(ctx: unknown): Context {
  if (typeof ctx !== 'object' || ctx === null || Array.isArray(ctx)) return {};
  const out: Context = {};
  for (const [k, v] of Object.entries(ctx)) if (isPrimitive(v)) out[k] = v as Context[string];
  return out;
}
