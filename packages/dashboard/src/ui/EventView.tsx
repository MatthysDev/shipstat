import { useEffect, useState } from 'react';
import { breakdownKeys, breakdownTable, dailyBy, eventNames, eventSummary, period, recentEvents, type Filters, type Range } from '../data/queries';
import { fmtAgo, fmtInt } from '../lib/format';
import { go } from './App';
import { Legend, Lines, PALETTE } from './charts';
import { FilterBar, RangePicker } from './FilterBar';
import { useAsync } from './hooks';

type Metric = 'events' | 'users';

export function EventView(props: { name?: string; range: Range; setRange: (r: Range) => void; filters: Filters; setFilters: (f: Filters) => void; version: number }) {
  const names = useAsync(eventNames, [props.version]);
  const name = props.name ?? names.data?.[0];
  const [key, setKey] = useState('app_version');
  const [metric, setMetric] = useState<Metric>('events');

  useEffect(() => setKey('app_version'), [name]);

  const keys = useAsync(async () => (name ? breakdownKeys(name) : []), [name, props.version]);
  const data = useAsync(async () => {
    if (!name) return null;
    const p = await period(props.range);
    const [summary, series, table, recent] = await Promise.all([
      eventSummary(p, props.filters, name),
      dailyBy(p, props.filters, key, { event: name, top: 5, metric }),
      breakdownTable(p, props.filters, name, key),
      recentEvents(name),
    ]);
    return { summary, series, table, recent };
  }, [name, key, metric, props.range, JSON.stringify(props.filters), props.version]);

  const d = data.data;
  const maxE = Math.max(1, ...(d?.table.map((r) => r.e) ?? [1]));
  const quick = (keys.data ?? []).slice(0, 4);
  const more = (keys.data ?? []).slice(4);

  return (
    <>
      <div className="crumb"><a href="#overview">Overview</a> / Events</div>
      <div className="head">
        <div>
          <select className="chip" style={{ height: 38, fontSize: 16, fontFamily: 'JetBrains Mono, monospace' }} value={name ?? ''} onChange={(e) => go({ page: 'event', name: e.target.value })} aria-label="Event">
            {(names.data ?? []).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          {d && <p>{fmtInt(d.summary.events)} events · {fmtInt(d.summary.users)} users · last {props.range}</p>}
        </div>
        <RangePicker range={props.range} setRange={props.setRange} />
      </div>
      <FilterBar filters={props.filters} setFilters={props.setFilters} version={props.version} />
      <div className="filters">
        <span className="muted">Split by</span>
        <div className="seg">
          {quick.map((k) => <button key={k} type="button" className={k === key ? 'on' : ''} onClick={() => setKey(k)}>{k}</button>)}
        </div>
        {more.length > 0 && (
          <select className={more.includes(key) ? 'chip on' : 'chip'} value={more.includes(key) ? key : ''} onChange={(e) => e.target.value && setKey(e.target.value)} aria-label="More properties">
            <option value="">More properties…</option>
            {more.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        )}
        <span className="spacer" />
        <div className="seg">
          <button type="button" className={metric === 'events' ? 'on' : ''} onClick={() => setMetric('events')}>Total</button>
          <button type="button" className={metric === 'users' ? 'on' : ''} onClick={() => setMetric('users')}>Unique users</button>
        </div>
      </div>
      {data.error && <div className="err">{data.error}</div>}
      {d && name && (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-head">
              <div><h2>{name} per {props.range === '24h' ? 'hour' : 'day'}, by {key}</h2><p>{metric === 'users' ? 'Unique users' : 'Event count'}; top 5 values, the rest grouped as “other”.</p></div>
              <Legend keys={d.series.keys} />
            </div>
            <div className="chart"><Lines keys={d.series.keys} points={d.series.points} /></div>
          </div>
          <div className="two">
            <div className="card">
              <div className="card-head"><div><h2>Breakdown by {key}</h2><p>Over the selected period</p></div></div>
              <table>
                <thead><tr><th>Value</th><th className="num">Events</th><th className="num">Users</th><th>Share</th></tr></thead>
                <tbody>
                  {d.table.map((r) => {
                    const i = d.series.keys.indexOf(String(r.v));
                    return (
                      <tr key={String(r.v)}>
                        <td><span className="ev"><i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: i >= 0 ? PALETTE[i % PALETTE.length] : 'var(--line)' }} /><code>{String(r.v)}</code></span></td>
                        <td className="num">{fmtInt(r.e)}</td>
                        <td className="num">{fmtInt(r.u)}</td>
                        <td className="bar-cell"><div className="mini-bar"><div style={{ width: `${(r.e / maxE) * 100}%` }} /></div></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="card">
              <div className="card-head"><div><h2>Latest events</h2><p>Check that your tags arrive as expected</p></div></div>
              <table>
                <tbody>
                  {d.recent.map((r, i) => (
                    <tr key={i}>
                      <td className="faint" style={{ width: 84, fontSize: 12.5 }}>{fmtAgo(new Date(r.ts))}</td>
                      <td className="mono json" style={{ fontSize: 12 }}>
                        {r.props}
                        <br />
                        <span className="faint">{r.context}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}
