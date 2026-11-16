import { useState } from 'react';
import { breakdownKeys, distinctValues, eventNames } from '../../data/queries';
import { FILTER_KEYS, RANGES, type Metric } from '../../data/sql';
import { METRIC_LABELS, VIZ_LABELS, type Viz, type Widget } from '../../lib/boards';
import { useAsync } from '../hooks';
import { WidgetView } from './WidgetView';

const VIZ_HELP: Record<Viz, string> = {
  line: 'Trend over time, one line per value of the split.',
  bar: 'Stacked bars over time.',
  number: 'One number, compared with the previous period.',
  pie: 'Share of each value of the split.',
  table: 'Ranked values of the split.',
  funnel: 'Users who do each step after the previous one.',
};

/** Side-by-side form and live preview. */
export function WidgetEditor({ value, version, onSave, onCancel }: { value: Widget; version: number; onSave: (w: Widget) => void; onCancel: () => void }) {
  const [w, setW] = useState(value);
  const set = (patch: Partial<Widget>) => setW((cur) => ({ ...cur, ...patch }));
  const names = useAsync(eventNames, [version]);
  const keys = useAsync(() => breakdownKeys(w.event), [w.event, version]);
  const values = useAsync(async () => Object.fromEntries(await Promise.all(FILTER_KEYS.map(async (k) => [k, await distinctValues(k)] as const))), [version]);
  const splitOptions = ['name', ...(keys.data ?? [])];
  const steps = w.steps ?? ['', ''];

  return (
    <div className="editor">
      <form className="card" onSubmit={(e) => { e.preventDefault(); onSave(w); }}>
        <label className="field">Title<input className="input" value={w.title} onChange={(e) => set({ title: e.target.value })} /></label>

        <div className="field">Chart
          <div className="viz-picker">
            {(Object.keys(VIZ_LABELS) as Viz[]).map((v) => (
              <button key={v} type="button" className={v === w.viz ? 'tab on' : 'tab'} onClick={() => set({ viz: v, steps: v === 'funnel' ? w.steps ?? ['', ''] : w.steps })}>{VIZ_LABELS[v]}</button>
            ))}
          </div>
          <span className="faint" style={{ fontWeight: 400 }}>{VIZ_HELP[w.viz]}</span>
        </div>

        {w.viz === 'funnel' ? (
          <div className="field">Steps
            {steps.map((s, i) => (
              <div key={i} className="step-row">
                <span className="faint">{i + 1}</span>
                <select className="input" value={s} onChange={(e) => set({ steps: steps.map((x, j) => (j === i ? e.target.value : x)) })}>
                  <option value="">Choose an event…</option>
                  {(names.data ?? []).map((n) => <option key={n}>{n}</option>)}
                </select>
                {steps.length > 2 && <button type="button" className="btn" onClick={() => set({ steps: steps.filter((_, j) => j !== i) })} aria-label={`Remove step ${i + 1}`}>×</button>}
              </div>
            ))}
            {steps.length < 8 && <button type="button" className="btn" onClick={() => set({ steps: [...steps, ''] })}>Add step</button>}
          </div>
        ) : (
          <label className="field">Event
            <select className="input" value={w.event ?? ''} onChange={(e) => set({ event: e.target.value || undefined })}>
              <option value="">All events</option>
              {(names.data ?? []).map((n) => <option key={n}>{n}</option>)}
            </select>
          </label>
        )}

        <div className="form-grid two-col">
          {w.viz !== 'funnel' && (
            <label className="field">Measure
              <select className="input" value={w.metric} onChange={(e) => set({ metric: e.target.value as Metric })}>
                {(Object.keys(METRIC_LABELS) as Metric[]).map((m) => <option key={m} value={m}>{METRIC_LABELS[m]}</option>)}
              </select>
            </label>
          )}
          {w.viz !== 'number' && (
            <label className="field">Split by
              <select className="input" value={w.split ?? ''} onChange={(e) => set({ split: e.target.value || undefined })}>
                <option value="">{w.viz === 'pie' || w.viz === 'table' ? 'Event name' : 'No split'}</option>
                {splitOptions.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </label>
          )}
          <label className="field">Period
            <select className="input" value={w.range} onChange={(e) => set({ range: e.target.value as Widget['range'] })}>
              {RANGES.map((r) => <option key={r}>{r}</option>)}
            </select>
          </label>
          <label className="field">Width
            <select className="input" value={w.size} onChange={(e) => set({ size: Number(e.target.value) as Widget['size'] })}>
              <option value={1}>1 / 3</option>
              <option value={2}>2 / 3</option>
              <option value={3}>Full</option>
            </select>
          </label>
        </div>

        <div className="field">Filters
          <div className="form-grid two-col">
            {FILTER_KEYS.map((k) => (
              <select key={k} className="input" value={w.filters[k] ?? ''} onChange={(e) => set({ filters: { ...w.filters, [k]: e.target.value || undefined } })} aria-label={k}>
                <option value="">{k}: all</option>
                {(values.data?.[k] ?? []).map((v) => <option key={v} value={v}>{k}: {v}</option>)}
              </select>
            ))}
          </div>
        </div>

        <div className="row-actions">
          <button className="btn primary" type="submit">Save</button>
          <button className="btn" type="button" onClick={onCancel}>Cancel</button>
        </div>
      </form>
      <div className="card editor-preview">
        <div className="card-head"><h2>{w.title || 'Preview'}</h2></div>
        <WidgetView w={w} version={version} />
      </div>
    </div>
  );
}
