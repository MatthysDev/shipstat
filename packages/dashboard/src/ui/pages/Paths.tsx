import { useState } from 'react';
import { eventNames, paths } from '../../data/queries';
import { period, type Filters, type Range } from '../../data/sql';
import { fmtInt, fmtPct } from '../../lib/format';
import { buildFlow, topPaths, type Direction } from '../../lib/paths';
import { go } from '../../lib/router';
import { PathFlow } from '../charts/PathFlow';
import { EventDocCard, EventName, EventOptions } from '../EventDoc';
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

export function Paths({ name: routeName, range, setRange, filters, setFilters, version }: Props) {
  const names = useAsync(eventNames, [version]);
  const name = routeName ?? names.data?.[0];
  const [direction, setDirection] = useState<Direction>('after');
  const [depth, setDepth] = useState(3);
  const [gap, setGap] = useState(30);
  const [top, setTop] = useState(5);
  const [collapse, setCollapse] = useState(true);

  const res = useAsync(async () => {
    if (!name) return null;
    const rows = await paths(await period(range), filters, { event: name, direction, depth, gapMinutes: gap, collapse });
    return { flow: buildFlow(name, rows, depth, top), top: topPaths(rows) };
  }, [name, direction, depth, gap, top, collapse, range, filters, version]);
  const d = res.data;
  const before = direction === 'before';

  return (
    <>
      <div className="head">
        <div>
          <h1>Paths</h1>
          <p>What users do right {before ? 'before' : 'after'} an event, in the same session. Each user counts once.</p>
        </div>
        <RangePicker range={range} setRange={setRange} />
      </div>
      <div className="filters">
        <div className="seg" role="group" aria-label="Direction">
          <button type="button" className={!before ? 'on' : ''} onClick={() => setDirection('after')}>Starting at</button>
          <button type="button" className={before ? 'on' : ''} onClick={() => setDirection('before')}>Ending at</button>
        </div>
        <select className="chip event-picker" value={name ?? ''} onChange={(e) => go({ page: 'paths', name: e.target.value })} aria-label="Event">
          <EventOptions names={names.data ?? []} />
        </select>
        <span className="spacer" />
        <select className="chip" value={depth} onChange={(e) => setDepth(Number(e.target.value))} aria-label="Steps">
          {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} step{n > 1 ? 's' : ''}</option>)}
        </select>
        <select className="chip" value={top} onChange={(e) => setTop(Number(e.target.value))} aria-label="Events per step">
          {[3, 5, 8, 12].map((n) => <option key={n} value={n}>Top {n} per step</option>)}
        </select>
        <select className="chip" value={gap} onChange={(e) => setGap(Number(e.target.value))} aria-label="Session gap">
          {[5, 15, 30, 60, 240].map((n) => <option key={n} value={n}>Session ends after {n < 60 ? `${n} min` : `${n / 60} h`}</option>)}
        </select>
        <button type="button" className={collapse ? 'chip on' : 'chip'} onClick={() => setCollapse(!collapse)} title="Count back-to-back repeats of an event as one step">Merge repeats</button>
      </div>
      <FilterBar filters={filters} setFilters={setFilters} version={version} />
      {name && <EventDocCard key={name} name={name} props={[]} />}
      {res.error && <div className="err">{res.error}</div>}
      {res.loading && <div className="loading inline">Updating…</div>}
      {d && name && (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-head">
              <div>
                <h2>{fmtInt(d.flow.total)} users {before ? 'reached' : 'did'} <code>{name}</code>, {before ? 'coming from' : 'then'}</h2>
                <p>Top {top} events per step, the rest grouped as “Others”. “stop” is the share whose session ends there. Click an event to follow it.</p>
              </div>
            </div>
            <PathFlow flow={d.flow} direction={direction} height={300} onPick={(n) => go({ page: 'paths', name: n })} />
          </div>
          <div className="card">
            <div className="card-head"><div><h2>Most common paths</h2><p>Complete sequences, {before ? 'ending at' : 'starting at'} {name}</p></div></div>
            <table>
              <thead><tr><th>Path</th><th className="num">Users</th><th className="num">Share</th></tr></thead>
              <tbody>
                {d.top.map((p) => {
                  const seq = before ? [...p.steps].reverse() : p.steps;
                  const all = before ? [...seq, name] : [name, ...seq];
                  return (
                    <tr key={all.join('>')}>
                      <td className="path-seq">
                        {before && p.steps.length < depth && <span className="faint">session start → </span>}
                        {all.map((s, i) => (
                          <span key={i}>{i > 0 && <span className="faint"> → </span>}<EventName name={s} /></span>
                        ))}
                        {!before && p.steps.length < depth && <span className="faint"> → end of session</span>}
                      </td>
                      <td className="num">{fmtInt(p.users)}</td>
                      <td className="num">{fmtPct(d.flow.total ? p.users / d.flow.total : 0, 1)}</td>
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
