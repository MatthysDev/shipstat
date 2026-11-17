import { syncApi, type ApiSource } from './sources';

/**
 * Polls a read endpoint from a cursor and reports how many new events arrived.
 * Returns a function that stops it.
 */
export function startLive(src: ApiSource, cursor: string, onNew: (added: number) => void, onError: (message: string) => void, intervalMs = 2000) {
  let stopped = false;
  let position = cursor;
  let timer: ReturnType<typeof setTimeout>;
  const tick = async () => {
    try {
      const r = await syncApi(src, undefined, position);
      if (r.cursor) position = r.cursor;
      if (r.added > 0 && !stopped) onNew(r.added);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
    if (!stopped) timer = setTimeout(tick, intervalMs);
  };
  timer = setTimeout(tick, intervalMs);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

export interface ServerConfig {
  /** Absent on a static host that only shares a workspace. */
  source?: ApiSource;
  /** The read endpoint needs a key the server does not give out: ask the person once. */
  needsKey?: boolean;
  live?: boolean;
  name?: string;
  /** Shared workspace (boards, catalog, branding), inline or by URL. */
  workspace?: unknown;
  workspaceUrl?: string;
}

/**
 * Present when the dashboard is served by `shipstat-dashboard`, or when a static host puts a
 * `shipstat.config.json` next to index.html.
 */
export async function readServerConfig(): Promise<ServerConfig | null> {
  try {
    const res = await fetch('./shipstat.config.json', { cache: 'no-store' });
    if (!res.ok || !res.headers.get('content-type')?.includes('json')) return null;
    const v = (await res.json()) as ServerConfig;
    if (!v || typeof v !== 'object') return null;
    const source = v.source && typeof v.source.url === 'string' ? v.source : undefined;
    const workspaceUrl = typeof v.workspaceUrl === 'string' ? v.workspaceUrl : undefined;
    if (!source && !v.workspace && !workspaceUrl) return null;
    return { ...v, source, workspaceUrl, needsKey: v.needsKey === true };
  } catch {
    return null;
  }
}

/** Read keys typed by the person, per server, kept in this browser only. */
const KEY_STORE = 'shipstat.readKey';

export function savedReadKey(): string | null {
  try {
    return localStorage.getItem(`${KEY_STORE}:${location.origin}`);
  } catch {
    return null;
  }
}

export function saveReadKey(key: string | null): void {
  try {
    if (key) localStorage.setItem(`${KEY_STORE}:${location.origin}`, key);
    else localStorage.removeItem(`${KEY_STORE}:${location.origin}`);
  } catch {
    // Private mode: asked again next time.
  }
}
