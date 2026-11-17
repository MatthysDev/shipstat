import { useCallback, useEffect, useRef, useState } from 'react';
import { restoreCache, saveCache } from '../data/cache';
import { countEvents, insertEvents, stitchIdentities } from '../data/db';
import { applyBranding, brandingStore } from '../lib/branding';
import { demoEvents, demoWorkspace } from '../lib/demo';
import { applyShared, loadSharedWorkspace, parseWorkspace } from '../lib/workspace';
import { readServerConfig, saveReadKey, savedReadKey, startLive } from '../data/live';
import { syncApi, type ApiSource } from '../data/sources';
import type { Filters, Range } from '../data/sql';
import { parseHash, type Route } from '../lib/router';
import { Boards } from './pages/Boards';
import { Catalog } from './pages/Catalog';
import { DataView } from './pages/DataView';
import { EventView } from './pages/EventView';
import { Experiments } from './pages/Experiments';
import { Overview } from './pages/Overview';
import { Paths } from './pages/Paths';
import { Settings, type SharedInfo } from './pages/Settings';
import { Sidebar } from './Sidebar';

export interface Loaded {
  count: number;
  /** Bumped every time events change, so every query refreshes. */
  version: number;
  source?: string;
  at?: Date;
  /** Polling the source for new events. */
  live?: boolean;
  /** Events added by the last live update, for a short highlight. */
  lastAdded?: number;
}

export interface LiveControl {
  start: (src: ApiSource, label: string) => void;
  stop: () => void;
}

export default function App() {
  const [route, setRoute] = useState<Route>(() => parseHash(location.hash));
  const [range, setRange] = useState<Range>('30d');
  const [filters, setFilters] = useState<Filters>({});
  const [loaded, setLoaded] = useState<Loaded>({ count: 0, version: 0 });
  const [booting, setBooting] = useState<string | null>('Starting DuckDB…');
  const [sharedInfo, setShared] = useState<SharedInfo | null>(null);
  const [keyPrompt, setKeyPrompt] = useState<{ error?: string; resolve: (key: string) => void } | null>(null);
  const askKey = (error?: string) => new Promise<string>((resolve) => setKeyPrompt({ error, resolve }));

  // Branding is CSS variables, the tab title and the favicon: follow every change.
  useEffect(() => {
    applyBranding(brandingStore.get());
    return brandingStore.subscribe(() => applyBranding(brandingStore.get()));
  }, []);

  useEffect(() => {
    const on = () => setRoute(parseHash(location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  const refresh = useCallback(async (source?: string, at = new Date()) => {
    const count = await countEvents();
    setLoaded((l) => ({ count, version: l.version + 1, source: source ?? l.source, at }));
  }, []);

  const stopLive = useRef<(() => void) | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const live: LiveControl = {
    start: (src, label) => {
      stopLive.current?.();
      setLoaded((l) => ({ ...l, live: true }));
      // From the start of the source: the first tick catches up, duplicates are ignored.
      stopLive.current = startLive(
        src,
        '',
        async (added) => {
          await stitchIdentities();
          const count = await countEvents();
          setLoaded((l) => ({ ...l, count, version: l.version + 1, source: label, at: new Date(), lastAdded: added }));
          // Keep the browser copy current without writing it on every tick.
          clearTimeout(saveTimer.current);
          saveTimer.current = setTimeout(() => saveCache(label), 5000);
        },
        () => undefined
      );
    },
    stop: () => {
      stopLive.current?.();
      stopLive.current = null;
      setLoaded((l) => ({ ...l, live: false }));
    },
  };

  // Apply the shared workspace first, so boards and branding are right on the first screen.
  // Then restore the events kept from the previous visit and, when served by
  // `shipstat-dashboard`, connect to that server and follow it live.
  useEffect(() => {
    (async () => {
      const demo = new URLSearchParams(location.search).has('demo');
      const server = await readServerConfig();
      const ws = server ? await loadSharedWorkspace(server) : demo ? parseWorkspace(demoWorkspace()) : null;
      if (ws) setShared({ from: server ? (server.workspaceUrl ?? 'the server') : 'the demo', applied: applyShared(ws) });
      const meta = await restoreCache();
      if (meta) await refresh(meta.source, new Date(meta.savedAt));
      // `?demo`: the hosted demo opens straight on sample data.
      if (demo && (await countEvents()) === 0) {
        setBooting('Generating demo data…');
        await insertEvents(demoEvents());
        await stitchIdentities();
        await refresh('demo data');
        await saveCache('demo data');
      }
      if (server?.source) {
        let src = server.source;
        const label = server.name ?? location.host;
        let key = server.needsKey ? savedReadKey() : null;
        for (let attempt = 0; ; attempt++) {
          if (server.needsKey) {
            if (!key) {
              setBooting(null);
              key = await askKey(attempt > 0 ? 'That key was refused.' : undefined);
              setKeyPrompt(null);
            }
            src = { ...server.source, headerName: 'Authorization', headerValue: `Bearer ${key}` };
          }
          setBooting(`Loading events from ${label}…`);
          try {
            await syncApi(src, (n) => setBooting(`Loading events from ${label}… ${n.toLocaleString('en-US')}`));
            if (key) saveReadKey(key);
            break;
          } catch (e) {
            if (!server.needsKey || !String(e instanceof Error ? e.message : e).startsWith('401')) throw e;
            saveReadKey(null);
            key = null;
          }
        }
        await stitchIdentities();
        await refresh(label);
        if (server.live) live.start(src, label);
      }
      setBooting(null);
    })().catch(() => setBooting(null));
    return () => stopLive.current?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const needsData = loaded.count === 0 && route.page !== 'data' && route.page !== 'settings' && route.page !== 'catalog';
  const shared = { range, setRange, filters, setFilters, version: loaded.version };

  return (
    <div className="app">
      <Sidebar route={route} loaded={loaded} />
      <main className="main">
        {keyPrompt ? (
          <KeyPrompt error={keyPrompt.error} onKey={keyPrompt.resolve} />
        ) : booting ? (
          <div className="loading">{booting}</div>
        ) : needsData ? (
          <Empty waiting={!!loaded.live} />
        ) : (
          <>
            {route.page === 'boards' && <Boards id={route.id} version={loaded.version} />}
            {route.page === 'overview' && <Overview {...shared} />}
            {route.page === 'event' && <EventView name={route.name} {...shared} />}
            {route.page === 'paths' && <Paths name={route.name} {...shared} />}
            {route.page === 'experiments' && <Experiments version={loaded.version} />}
            {route.page === 'catalog' && <Catalog version={loaded.version} />}
            {route.page === 'settings' && <Settings shared={sharedInfo} />}
            {route.page === 'data' && <DataView loaded={loaded} onLoaded={refresh} live={live} />}
          </>
        )}
      </main>
    </div>
  );
}

function KeyPrompt({ error, onKey }: { error?: string; onKey: (key: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <form
      className="card empty"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) onKey(value.trim());
      }}
    >
      <h2>Read key</h2>
      <p>This server keeps its events behind a key. Ask whoever runs it, paste it here: it stays in this browser.</p>
      <div style={{ display: 'flex', gap: 8, maxWidth: 420, margin: '0 auto' }}>
        <input className="input" type="password" autoFocus autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Read key" />
        <button className="btn primary" type="submit" disabled={!value.trim()}>Open</button>
      </div>
      {error && <p role="alert" style={{ color: 'var(--accent)', marginTop: 12 }}>{error}</p>}
    </form>
  );
}

function Empty({ waiting }: { waiting: boolean }) {
  if (waiting) {
    return (
      <div className="card empty">
        <h2><span className="dot live" />Waiting for your first event</h2>
        <p>This dashboard is connected to its server and updates live. Send an event from your app and it shows up here within a couple of seconds.</p>
        <pre className="code" style={{ display: 'inline-block', textAlign: 'left' }}>{`Shipstat.init({ endpoint: '${location.origin}/events' });\nShipstat.track('app_opened');`}</pre>
      </div>
    );
  }
  return (
    <div className="card empty">
      <h2>No events loaded yet</h2>
      <p>
        Shipstat stores nothing on a server. Load your events from your API, a file export or Supabase, and they are analysed
        right here in your browser. Or try it with demo data.
      </p>
      <a className="btn primary" href="#data">Load events</a>
    </div>
  );
}
