import { breakdown, funnel, series, total } from '../../data/queries';
import { period } from '../../data/sql';
import type { Widget } from '../../lib/boards';
import { fmtCompact, fmtInt, fmtSignedPct } from '../../lib/format';
import { Bars } from '../charts/Bars';
import { Donut } from '../charts/Donut';
import { Funnel } from '../charts/Funnel';
import { Legend } from '../charts/Legend';
import { Lines } from '../charts/Lines';
import { Sparkline } from '../charts/Sparkline';
import { useAsync } from '../hooks';

/** Loads and draws one widget. Pure function of its config and the loaded data. */
export function WidgetView({ w, version, height = 220 }: { w: Widget; version: number; height?: number }) {
  const res = useAsync(() => load(w), [w, version]);
  if (res.error) return <div className="err">{res.error}</div>;
  const d = res.data;
  if (!d) return <div className="loading">Loading…</div>;
  const hourly = w.range === '24h';

  switch (d.kind) {
    case 'number': {
      const delta = d.prev ? d.value / d.prev - 1 : null;
      return (
        <div className="number-widget">
          <div className="kpi-value">{w.metric === 'per_user' ? d.value.toFixed(1) : fmtCompact(d.value)}</div>
          <div className={delta === null ? 'delta' : delta >= 0 ? 'delta up' : 'delta down'}>
            {delta === null ? <span>no previous period</span> : <>{fmtSignedPct(delta, 1)} <span>vs previous {w.range}</span></>}
          </div>
          <Sparkline values={d.spark} />
        </div>
      );
    }
    case 'series':
      return (
        <>
          <Legend keys={d.series.keys} />
          {w.viz === 'bar' ? <Bars data={d.series} height={height} hourly={hourly} /> : <Lines data={d.series} height={height} hourly={hourly} />}
        </>
      );
    case 'pie':
      return <Donut slices={d.rows.map((r) => ({ label: r.value, value: r.n }))} />;
    case 'table': {
      const max = Math.max(1, ...d.rows.map((r) => r.n));
      return (
        <div className="table-scroll">
          <table>
            <thead><tr><th>{w.split || 'value'}</th><th className="num">{w.metric === 'users' ? 'Users' : w.metric === 'per_user' ? 'Per user' : 'Events'}</th><th /></tr></thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={r.value}>
                  <td><code>{r.value}</code></td>
                  <td className="num">{w.metric === 'per_user' ? r.n.toFixed(1) : fmtInt(r.n)}</td>
                  <td className="bar-cell"><div className="mini-bar"><div style={{ width: `${(r.n / max) * 100}%` }} /></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    case 'funnel':
      return d.steps.length < 2 ? <p className="muted">Pick at least two steps.</p> : <Funnel steps={d.steps} data={d.data} />;
  }
}

async function load(w: Widget) {
  const p = await period(w.range);
  switch (w.viz) {
    case 'number': {
      const [t, s] = await Promise.all([total(p, w.filters, w.metric, w.event), series(p, w.filters, { event: w.event, metric: w.metric })]);
      return { kind: 'number' as const, ...t, spark: s.points.map((x) => x.n) };
    }
    case 'line':
    case 'bar':
      return { kind: 'series' as const, series: await series(p, w.filters, { key: w.split, event: w.event, metric: w.metric, top: 5 }) };
    case 'pie':
      return { kind: 'pie' as const, rows: await breakdown(p, w.filters, w.split || 'name', { event: w.event, metric: w.metric, limit: 12 }) };
    case 'table':
      return { kind: 'table' as const, rows: await breakdown(p, w.filters, w.split || 'name', { event: w.event, metric: w.metric, limit: 12 }) };
    case 'funnel': {
      const steps = (w.steps ?? []).filter(Boolean);
      return { kind: 'funnel' as const, steps, data: steps.length >= 2 ? await funnel(p, w.filters, steps, w.split) : [] };
    }
  }
}
