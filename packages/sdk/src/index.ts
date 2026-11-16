import Native from './ShipstatModule';
import type { Context, Props, ShipstatConfig } from './Shipstat.types';
import { checkContext, checkEvent, normalizeConfig } from './validate';
import { SDK_VERSION } from './version';

export * from './Shipstat.types';

declare const __DEV__: boolean;
const dev = typeof __DEV__ !== 'undefined' && __DEV__;

function warn(errors: string[]) {
  if (errors.length) console.warn('[shipstat] ' + errors.join('\n[shipstat] '));
}

function readOtaId(): string | null {
  try {
    // Optional: only present when the app uses expo-updates.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Updates = require('expo-updates');
    return (Updates && typeof Updates.updateId === 'string' && Updates.updateId) || null;
  } catch {
    return null;
  }
}

/** Configure the endpoint. Events tracked before init are kept and sent afterwards. */
export function init(config: ShipstatConfig): void {
  Native.init({ ...normalizeConfig(config), sdkVersion: SDK_VERSION, ota: readOtaId() });
}

/** Record an event. Returns immediately; storage and upload happen on a native background queue. */
export function track(name: string, props?: Props): void {
  if (dev) {
    const errors = checkEvent(name, props);
    if (errors.length) return warn(errors);
  }
  Native.track(name, props ?? null, Date.now());
}

/** Merge keys into the global context added to every following event. Persisted across launches. */
export function setContext(ctx: Context): void {
  if (dev) {
    const errors = checkContext(ctx);
    if (errors.length) return warn(errors);
  }
  Native.setContext(ctx);
}

/** Remove keys from the global context. */
export function unsetContext(...keys: string[]): void {
  Native.unsetContext(keys);
}

/** Attach your own user id to following events. null on sign-out. */
export function identify(userId: string | null): void {
  Native.identify(userId);
}

/** User opt-out / opt-in. Persisted. When disabled, nothing is stored or sent. */
export function setEnabled(enabled: boolean): void {
  Native.setEnabled(enabled);
}

/** New anonymous id, context and user id cleared. Waiting events are kept. */
export function reset(): void {
  Native.reset();
}

/** Send waiting events now. Resolves when the attempt is over (sent or not). */
export function flush(): Promise<void> {
  return Native.flush();
}

/** The anonymous id of this install. */
export function getAnonId(): string {
  return Native.getAnonId();
}

const Shipstat = { init, track, setContext, unsetContext, identify, setEnabled, reset, flush, getAnonId };
export default Shipstat;
