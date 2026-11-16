import { useState } from 'react';
import { breakdown, breakdownKeys, eventNames, recentEvents, series, total } from '../../data/queries';
import { period, type Filters, type Metric, type Range } from '../../data/sql';
import { fmtAgo, fmtInt } from '../../lib/format';
import { color } from '../../lib/palette';
import { go } from '../../lib/router';
import { Legend } from '../charts/Legend';
import { Lines } from '../charts/Lines';
import { FilterBar, RangePicker } from '../FilterBar';
import { useAsync } from '../hooks';

interface Props {
  name?: string;
  range: Range;
  setRange: (r: Range) => void;
  filters: Filters;
  setFilters: (f: Filters) => void;
  version: number;
}

export function EventView({ name: routeName, range, setRange, filters, setFilters, version }: Props) {
  const names = useAsync(eventNames, [version]);
  const name = routeName ?? names.data?.[0];
  // The split resets when the event changes: keep it keyed by event.
  const [split, setSplit] = useState<{ event?: string; key: string }>({ key: 'app_version' });
  const key = split.event === name ? split.key : 'app_version';
  const [metric, setMetric] = useState<Metric>('events');

  const keys = useAsync(() => (name ? breakdownKeys(name) : Promise.resolve([])), [name, version]);
  const res = useAsync(async () => {
    if (!name) return null;
    const p = await period(range);
    const [events, users, chart, table, recent] = await Promise.all([
      total(p, filters, 'events', name),
      total(p, filters, 'users', name),
      series(p, filters, { key, event: name, top: 5, metric }),
      breakdown(p, filters, key, { event: name }),
      recentEvents(name),
    ]);
    return { events, users, chart, table, recent };
  }, [name, key, metric, range, filters, version]);

  const d = res.data;
  const quick = (keys.data ?? []).slice(0, 4);
  const more = (keys.data ?? []).slice(4);
  const pick = (k: string) => setSplit({ event: name, key: k });
  const maxE = Math.max(1, ...(d?.table.map((r) => r.events) ?? []));

  return (
    <>
      <div className="crumb"><a href="#overview">Overview</a> / Events</div>
      <div className="head">
        <div>
          <select className="chip event-picker" value={name ?? ''} onChange={(e) => go({ page: 'event', name: e.target.value })} aria-label="Event">
            {(names.data ?? []).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          {d && <p>{fmtInt(d.events.value)} events · {fmtInt(d.users.value)} users · last {range}</p>}
        </div>
        <RangePicker range={range} setRange={setRange} />
      </div>
      <FilterBar filters={filters} setFilters={setFilters} version={version} />
      <div className="filters">
        <span className="muted">Split by</span>
        <div className="seg">
          {quick.map((k) => <button key={k} type="button" className={k === key ? 'on' : ''} onClick={() => pick(k)}>{k}</button>)}
        </div>
        {more.length > 0 && (
          <select className={more.includes(key) ? 'chip on' : 'chip'} value={more.includes(key) ? key : ''} onChange={(e) => e.target.value && pick(e.target.value)} aria-label="More properties">
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
      {res.error && <div className="err">{res.error}</div>}
      {d && name && (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-head">
              <div><h2>{name} per {range === '24h' ? 'hour' : 'day'}, by {key}</h2><p>{metric === 'users' ? 'Unique users' : 'Event count'}; top 5 values, the rest grouped as “other”.</p></div>
              <Legend keys={d.chart.keys} />
            </div>
            <Lines data={d.chart} hourly={range === '24h'} />
          </div>
          <div className="two">
            <div className="card">
              <div className="card-head"><div><h2>Breakdown by {key}</h2><p>Over the selected period</p></div></div>
              <table>
                <thead><tr><th>Value</th><th className="num">Events</th><th className="num">Users</th><th>Share</th></tr></thead>
                <tbody>
                  {d.table.map((r) => {
                    const i = d.chart.keys.indexOf(r.value);
                    return (
                      <tr key={r.value}>
                        <td><span className="ev"><i className="dot-sm" style={{ background: i >= 0 ? color(i) : 'var(--line)' }} /><code>{r.value}</code></span></td>
                        <td className="num">{fmtInt(r.events)}</td>
                        <td className="num">{fmtInt(r.users)}</td>
                        <td className="bar-cell"><div className="mini-bar"><div style={{ width: `${(r.events / maxE) * 100}%` }} /></div></td>
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
                      <td className="faint ago">{fmtAgo(new Date(r.ts))}</td>
                      <td className="mono json">{r.props}<br /><span className="faint">{r.context}</span></td>
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
