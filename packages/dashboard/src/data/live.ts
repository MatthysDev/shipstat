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
  source: ApiSource;
  live: boolean;
  name?: string;
}

/** Present when the dashboard is served by `shipstat-dashboard`. */
export async function readServerConfig(): Promise<ServerConfig | null> {
  try {
    const res = await fetch('./shipstat.config.json', { cache: 'no-store' });
    if (!res.ok || !res.headers.get('content-type')?.includes('json')) return null;
    const v = (await res.json()) as ServerConfig;
    return v && v.source && typeof v.source.url === 'string' ? v : null;
  } catch {
    return null;
  }
}
