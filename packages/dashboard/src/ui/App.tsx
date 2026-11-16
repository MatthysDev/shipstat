import { useCallback, useEffect, useState } from 'react';
import { restoreCache } from '../data/cache';
import { countEvents } from '../data/db';
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
}

export default function App() {
  const [route, setRoute] = useState<Route>(() => parseHash(location.hash));
  const [range, setRange] = useState<Range>('30d');
  const [filters, setFilters] = useState<Filters>({});
  const [loaded, setLoaded] = useState<Loaded>({ count: 0, version: 0 });
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    const on = () => setRoute(parseHash(location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  const refresh = useCallback(async (source?: string, at = new Date()) => {
    const count = await countEvents();
    setLoaded((l) => ({ count, version: l.version + 1, source: source ?? l.source, at }));
  }, []);

  // Restore the events kept from the previous visit.
  useEffect(() => {
    restoreCache()
      .then((meta) => (meta ? refresh(meta.source, new Date(meta.savedAt)) : undefined))
      .finally(() => setBooting(false));
  }, [refresh]);

  const needsData = loaded.count === 0 && route.page !== 'data';
  const shared = { range, setRange, filters, setFilters, version: loaded.version };

  return (
    <div className="app">
      <Sidebar route={route} loaded={loaded} />
      <main className="main">
        {booting ? (
          <div className="loading">Starting DuckDB…</div>
        ) : needsData ? (
          <Empty />
        ) : (
          <>
            {route.page === 'boards' && <Boards id={route.id} version={loaded.version} />}
            {route.page === 'overview' && <Overview {...shared} />}
            {route.page === 'event' && <EventView name={route.name} {...shared} />}
            {route.page === 'experiments' && <Experiments version={loaded.version} />}
            {route.page === 'data' && <DataView loaded={loaded} onLoaded={refresh} />}
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
