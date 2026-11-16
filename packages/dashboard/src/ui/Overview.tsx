import { dailyBy, kpis, period, topEvents, type Filters, type Range } from '../data/queries';
import { fmtCompact, fmtInt, fmtPct, fmtSignedPct } from '../lib/format';
import { go } from './App';
import { Legend, StackedBars } from './charts';
import { FilterBar, RangePicker } from './FilterBar';
import { useAsync } from './hooks';

function Delta({ cur, prev }: { cur: number; prev: number }) {
  if (!prev) return <div className="delta"><span>no previous data</span></div>;
  const d = cur / prev - 1;
  return (
    <div className={d >= 0 ? 'delta up' : 'delta down'}>
      {fmtSignedPct(d, 1)} <span>vs previous period</span>
    </div>
  );
}

export function Overview({ range, setRange, filters, setFilters, version }: { range: Range; setRange: (r: Range) => void; filters: Filters; setFilters: (f: Filters) => void; version: number }) {
  const data = useAsync(async () => {
    const p = await period(range);
    const [k, series, top] = await Promise.all([kpis(p, filters), dailyBy(p, filters, 'app_version', { top: 3 }), topEvents(p, filters)]);
    return { k, series, top };
  }, [range, JSON.stringify(filters), version]);

  const d = data.data;
  const maxTotal = Math.max(1, ...(d?.top.map((t) => t.total) ?? [1]));

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
      {data.error && <div className="err">{data.error}</div>}
      {d && (
        <>
          <div className="grid kpis">
            <div className="card"><div className="kpi-label">Events</div><div className="kpi-value">{fmtCompact(d.k.events)}</div><Delta cur={d.k.events} prev={d.k.prevEvents} /></div>
            <div className="card"><div className="kpi-label">Unique users</div><div className="kpi-value">{fmtInt(d.k.users)}</div><Delta cur={d.k.users} prev={d.k.prevUsers} /></div>
            <div className="card"><div className="kpi-label">Events per user</div><div className="kpi-value">{d.k.users ? fmtInt(d.k.events / d.k.users) : '—'}</div><Delta cur={d.k.users ? d.k.events / d.k.users : 0} prev={d.k.prevUsers ? d.k.prevEvents / d.k.prevUsers : 0} /></div>
            <div className="card"><div className="kpi-label">Most used version</div><div className="kpi-value">{d.k.topVersion ?? '—'}</div><div className="delta"><span>{fmtPct(d.k.topVersionShare, 0)} of active users</span></div></div>
          </div>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-head">
              <div><h2>Events per {range === '24h' ? 'hour' : 'day'}, by app version</h2><p>See a new release take over, and whether usage follows.</p></div>
              <Legend keys={d.series.keys} />
            </div>
            <div className="chart"><StackedBars keys={d.series.keys} points={d.series.points} /></div>
          </div>
          <div className="card">
            <div className="card-head"><div><h2>Top events</h2><p>Click an event to split it by version, variant or any property.</p></div></div>
            <table>
              <thead><tr><th>Event</th><th className="num">Total</th><th className="num">Users</th><th>Share</th><th className="num">Trend</th><th>Properties</th></tr></thead>
              <tbody>
                {d.top.map((e) => {
                  const trend = e.prev ? e.total / e.prev - 1 : null;
                  return (
                    <tr key={e.name} className="row-link" style={{ cursor: 'pointer' }} onClick={() => go({ page: 'event', name: e.name })}>
                      <td><span className="ev"><code>{e.name}</code></span></td>
                      <td className="num">{fmtInt(e.total)}</td>
                      <td className="num">{fmtInt(e.users)}</td>
                      <td className="bar-cell"><div className="mini-bar"><div style={{ width: `${Math.max(1.5, (e.total / maxTotal) * 100)}%` }} /></div></td>
                      <td className="num">{trend === null ? <span className="faint">new</span> : <span className={trend >= 0 ? 'delta up' : 'delta down'}>{fmtSignedPct(trend)}</span>}</td>
                      <td className="faint mono">{e.keys || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      {!d && data.loading && <div className="loading">Crunching…</div>}
    </>
  );
}
