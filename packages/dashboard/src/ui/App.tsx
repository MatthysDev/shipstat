import { useCallback, useEffect, useState } from 'react';
import { countEvents } from '../data/db';
import type { Filters, Range } from '../data/queries';
import { loadProjects, saveProjects, type Project } from '../data/sources';
import { DataView } from './DataView';
import { EventView } from './EventView';
import { Experiments } from './Experiments';
import { Overview } from './Overview';
import { Sidebar } from './Sidebar';

export type Route = { page: 'overview' } | { page: 'event'; name?: string } | { page: 'experiments' } | { page: 'data' };

function readHash(): Route {
  const h = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  if (h.startsWith('event/')) return { page: 'event', name: h.slice(6) };
  if (h === 'event') return { page: 'event' };
  if (h === 'experiments') return { page: 'experiments' };
  if (h === 'data') return { page: 'data' };
  return { page: 'overview' };
}

export function go(r: Route) {
  location.hash = r.page === 'event' && r.name ? `event/${encodeURIComponent(r.name)}` : r.page;
}

export interface Loaded {
  count: number;
  /** Bumped every time events change, to refresh queries. */
  version: number;
  source?: string;
  at?: Date;
}

export default function App() {
  const [route, setRoute] = useState<Route>(readHash);
  const [range, setRange] = useState<Range>('30d');
  const [filters, setFilters] = useState<Filters>({});
  const [loaded, setLoaded] = useState<Loaded>({ count: 0, version: 0 });
  const [projects, setProjects] = useState<Project[]>(loadProjects);

  useEffect(() => {
    const on = () => setRoute(readHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  const refresh = useCallback(async (source?: string) => {
    const count = await countEvents();
    setLoaded((l) => ({ count, version: l.version + 1, source: source ?? l.source, at: new Date() }));
  }, []);

  const updateProjects = (p: Project[]) => {
    setProjects(p);
    saveProjects(p);
  };

  const empty = loaded.count === 0;
  const page = empty && route.page !== 'data' ? 'empty' : route.page;

  return (
    <div className="app">
      <Sidebar route={route} loaded={loaded} />
      <main className="main">
        {page === 'empty' && <Empty />}
        {page === 'overview' && <Overview range={range} setRange={setRange} filters={filters} setFilters={setFilters} version={loaded.version} />}
        {page === 'event' && route.page === 'event' && <EventView name={route.name} range={range} setRange={setRange} filters={filters} setFilters={setFilters} version={loaded.version} />}
        {page === 'experiments' && <Experiments version={loaded.version} />}
        {page === 'data' && <DataView projects={projects} setProjects={updateProjects} loaded={loaded} onLoaded={refresh} />}
      </main>
    </div>
  );
}

function Empty() {
  return (
    <div className="card empty">
      <h2>No events loaded yet</h2>
      <p>
        Shipstat stores nothing. Load your events from your API, a file export or Supabase, and they are analysed right here in your browser.
        Or try it with demo data first.
      </p>
      <a className="btn primary" href="#data">Load events</a>
    </div>
  );
}
