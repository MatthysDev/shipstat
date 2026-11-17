/**
 * Drop-in replacement for `vexo-analytics`. Migrate in two edits:
 *
 *   - import { vexo, customEvent, identifyDevice } from 'vexo-analytics';
 *   + import { vexo, customEvent, identifyDevice } from 'shipstat/vexo';
 *
 *   - vexo('YOUR_VEXO_KEY');
 *   + vexo('https://stats.example.com/events');   // or vexo({ endpoint, headers, ... })
 *
 * Every other call keeps working. Shipstat only records the events you send: screens, taps,
 * replays and heatmaps are not captured, so the matching calls are accepted and do nothing.
 */
import type { ReactNode } from 'react';

import type { Primitive, Props, ShipstatConfig } from '../Shipstat.types';
import { identify, init, setEnabled, track } from '../index';

declare const __DEV__: boolean;
const dev = typeof __DEV__ !== 'undefined' && __DEV__;

/** Vexo options, accepted for compatibility. Replay and performance capture do not exist here. */
export interface VexoOptions {
  sessionReplay?: boolean;
  performance?: boolean;
}

/** Start Shipstat. Pass your endpoint URL (or a full config) where the Vexo key used to be. */
export function vexo(config: string | ShipstatConfig, _options?: VexoOptions): void {
  if (typeof config === 'string' && !/^https?:\/\//.test(config)) {
    if (dev) console.warn('[shipstat] vexo() now takes your Shipstat endpoint URL, not a Vexo API key. Nothing will be sent.');
    return;
  }
  init(typeof config === 'string' ? { endpoint: config } : config);
}

/** Same as `track`. Nested objects are flattened (`cart.total`), since Shipstat props are flat. */
export function customEvent(name: string, args?: object): void {
  track(name, args ? flatten(args) : undefined);
}

/** Same as `identify`. Prefer an internal id over an email: the id is stored with every event. */
export function identifyDevice(id: string | null): Promise<void> {
  identify(id);
  return Promise.resolve();
}

export function enableTracking(): Promise<void> {
  setEnabled(true);
  return Promise.resolve();
}

export function disableTracking(): Promise<void> {
  setEnabled(false);
  return Promise.resolve();
}

/** Recorded as a `screen_viewed` event, since you call it explicitly. */
export function trackScreen(name: string, properties?: object): void {
  track('screen_viewed', { screen: name, ...(properties ? flatten(properties) : {}) });
}

/**
 * Recorded as an `error` event (message and handled flag), so error counts show in the dashboard.
 * Shipstat is not a crash reporter: keep one for stack traces and native crashes.
 */
export function trackError(error: unknown, options?: { handled?: boolean }): void {
  const message = error instanceof Error ? error.message : String(error);
  track('error', { message: message.slice(0, 500), handled: options?.handled ?? true });
}

/** Heatmaps do not exist in Shipstat: accepted and ignored. */
export function setHeatmapSegment(_value: string | null | undefined): void {}

type Children = { children?: ReactNode };

/** Session replay does not exist in Shipstat: these render their children unchanged. */
export const VexoMask = ({ children }: Children): ReactNode => children ?? null;
export const VexoUnmask = ({ children }: Children): ReactNode => children ?? null;
export const VexoProvider = ({ children }: Children & Record<string, unknown>): ReactNode => children ?? null;

/** `{ cart: { total: 3 }, tags: ['a'] }` → `{ 'cart.total': 3, tags: ['a'] }`. */
export function flatten(input: object, prefix = '', out: Props = {}, depth = 0): Props {
  for (const [key, value] of Object.entries(input)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (value === undefined || typeof value === 'function' || typeof value === 'symbol') continue;
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out[name] = value;
    } else if (value instanceof Date) {
      out[name] = value.toISOString();
    } else if (Array.isArray(value)) {
      out[name] = value.every(isPrimitive) ? (value as Primitive[]) : safeJson(value);
    } else if (typeof value === 'bigint') {
      out[name] = value.toString();
    } else if (depth < 3) {
      flatten(value as object, name, out, depth + 1);
    } else {
      out[name] = safeJson(value);
    }
  }
  return out;
}

function isPrimitive(v: unknown): v is Primitive {
  return v === null || ['string', 'number', 'boolean'].includes(typeof v);
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
