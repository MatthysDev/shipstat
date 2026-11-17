import { series, topEvents, topVersion, total } from '../../data/queries';
import { period, type Filters, type Range } from '../../data/sql';
import { fmtChange, fmtCompact, fmtInt, fmtPct } from '../../lib/format';
import { useCatalog } from '../../lib/catalog';
import { go } from '../../lib/router';
import { Bars } from '../charts/Bars';
import { Legend } from '../charts/Legend';
import { FilterBar, RangePicker } from '../FilterBar';
import { useAsync } from '../hooks';

interface Props {
  range: Range;
  setRange: (r: Range) => void;
  filters: Filters;
  setFilters: (f: Filters) => void;
  version: number;
}

function Delta({ cur, prev }: { cur: number; prev: number }) {
  if (!prev) return <div className="delta"><span>no previous data</span></div>;
  const d = cur / prev - 1;
  return <div className={d >= 0 ? 'delta up' : 'delta down'}>{fmtChange(d)} <span>vs previous period</span></div>;
}

export function Overview({ range, setRange, filters, setFilters, version }: Props) {
  const res = useAsync(async () => {
    const p = await period(range);
    const [events, users, perUser, top, byVersion, list] = await Promise.all([
      total(p, filters, 'events'),
      total(p, filters, 'users'),
      total(p, filters, 'per_user'),
      topVersion(p, filters),
      series(p, filters, { key: 'app_version', top: 3 }),
      topEvents(p, filters),
    ]);
    return { events, users, perUser, top, byVersion, list };
  }, [range, filters, version]);
  const cat = useCatalog();
  const d = res.data;
  const maxTotal = Math.max(1, ...(d?.list.map((t) => t.total) ?? []));

  return (
    <>
      <div className="head">
        <div>
          <h1>Overview</h1>
          <p>Only the events you send with <code>track()</code>. Nothing is captured automatically.</p>
        </div>
        <RangePicker range={range} setRange={setRange} />
      </div>
      <FilterBar filters={filters} setFilters={setFilters} version={version} />
      {res.error && <div className="err">{res.error}</div>}
      {!d && <div className="loading">Crunching…</div>}
      {d && (
        <>
          <div className="grid kpis">
            <div className="card"><div className="kpi-label">Events</div><div className="kpi-value">{fmtCompact(d.events.value)}</div><Delta cur={d.events.value} prev={d.events.prev} /></div>
            <div className="card"><div className="kpi-label">Unique users</div><div className="kpi-value">{fmtInt(d.users.value)}</div><Delta cur={d.users.value} prev={d.users.prev} /></div>
            <div className="card"><div className="kpi-label">Events per user</div><div className="kpi-value">{d.perUser.value.toFixed(1)}</div><Delta cur={d.perUser.value} prev={d.perUser.prev} /></div>
            <div className="card"><div className="kpi-label">Most used version</div><div className="kpi-value">{d.top.version ?? '—'}</div><div className="delta"><span>{fmtPct(d.top.share, 0)} of active users</span></div></div>
          </div>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-head">
              <div><h2>Events per {range === '24h' ? 'hour' : 'day'}, by app version</h2><p>See a new release take over, and whether usage follows.</p></div>
              <Legend keys={d.byVersion.keys} />
            </div>
            <Bars data={d.byVersion} height={250} hourly={range === '24h'} />
          </div>
          <div className="card">
            <div className="card-head"><div><h2>Top events</h2><p>Click an event to split it by version, variant or any property.</p></div></div>
            <table>
              <thead><tr><th>Event</th><th className="num">Total</th><th className="num">Users</th><th>Share</th><th className="num">Trend</th><th>Properties</th></tr></thead>
              <tbody>
                {d.list.map((e) => {
                  const trend = e.prev ? e.total / e.prev - 1 : null;
                  return (
                    <tr key={e.name} className="row-link" onClick={() => go({ page: 'event', name: e.name })}>
                      <td><span className="ev"><code>{e.name}</code></span>{cat.events[e.name]?.description && <div className="ev-sub">{cat.events[e.name].description}</div>}</td>
                      <td className="num">{fmtInt(e.total)}</td>
                      <td className="num">{fmtInt(e.users)}</td>
                      <td className="bar-cell"><div className="mini-bar"><div style={{ width: `${Math.max(1.5, (e.total / maxTotal) * 100)}%` }} /></div></td>
                      <td className="num">{trend === null ? <span className="faint">new</span> : <span className={trend >= 0 ? 'delta up' : 'delta down'}>{fmtChange(trend, 0)}</span>}</td>
                      <td className="faint mono">{e.keys || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
