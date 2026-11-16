import { useCallback, useEffect, useRef, useState } from 'react';
import { restoreCache, saveCache } from '../data/cache';
import { countEvents, insertEvents, stitchIdentities } from '../data/db';
import { demoEvents } from '../lib/demo';
import { readServerConfig, startLive } from '../data/live';
import { syncApi, type ApiSource } from '../data/sources';
import type { Filters, Range } from '../data/sql';
import { parseHash, type Route } from '../lib/router';
import { Boards } from './pages/Boards';
import { DataView } from './pages/DataView';
import { EventView } from './pages/EventView';
import { Experiments } from './pages/Experiments';
import { Overview } from './pages/Overview';
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

  // Restore the events kept from the previous visit, then, when served by
  // `shipstat-dashboard`, connect to that server and follow it live.
  useEffect(() => {
    (async () => {
      const meta = await restoreCache();
      if (meta) await refresh(meta.source, new Date(meta.savedAt));
      // `?demo`: the hosted demo opens straight on sample data.
      if (new URLSearchParams(location.search).has('demo') && (await countEvents()) === 0) {
        setBooting('Generating demo data…');
        await insertEvents(demoEvents());
        await stitchIdentities();
        await refresh('demo data');
        await saveCache('demo data');
      }
      const server = await readServerConfig();
      if (server) {
        const label = server.name ?? location.host;
        setBooting(`Loading events from ${label}…`);
        await syncApi(server.source, (n) => setBooting(`Loading events from ${label}… ${n.toLocaleString('en-US')}`));
        await stitchIdentities();
        await refresh(label);
        if (server.live) live.start(server.source, label);
      }
      setBooting(null);
    })().catch(() => setBooting(null));
    return () => stopLive.current?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const needsData = loaded.count === 0 && route.page !== 'data';
  const shared = { range, setRange, filters, setFilters, version: loaded.version };

  return (
    <div className="app">
      <Sidebar route={route} loaded={loaded} />
      <main className="main">
        {booting ? (
          <div className="loading">{booting}</div>
        ) : needsData ? (
          <Empty />
        ) : (
          <>
            {route.page === 'boards' && <Boards id={route.id} version={loaded.version} />}
            {route.page === 'overview' && <Overview {...shared} />}
            {route.page === 'event' && <EventView name={route.name} {...shared} />}
            {route.page === 'experiments' && <Experiments version={loaded.version} />}
            {route.page === 'data' && <DataView loaded={loaded} onLoaded={refresh} live={live} />}
          </>
        )}
      </main>
    </div>
  );
}

function Empty() {
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
