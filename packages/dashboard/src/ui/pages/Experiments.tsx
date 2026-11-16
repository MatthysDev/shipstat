import { useRef, useState } from 'react';
import { arms, armsByVersion, cumulative, exposuresPerDay, isExperiment, type Experiment } from '../../data/experiments';
import { distinctValues, eventNames } from '../../data/queries';
import { fmtInt, fmtPct, fmtSignedPct } from '../../lib/format';
import { color } from '../../lib/palette';
import { compare, exposuresNeeded, type Comparison } from '../../lib/stats';
import { newId } from '../../lib/boards';
import { downloadJson, isArray, readJson, writeJson } from '../../lib/storage';
import { Legend } from '../charts/Legend';
import { Lines } from '../charts/Lines';
import { useAsync } from '../hooks';

const KEY = 'shipstat.experiments.v1';
/** Probability above which a variant is called a winner (or below 1 − it, a loser). */
const THRESHOLD = 0.95;

const isExperiments = (v: unknown): v is Experiment[] => isArray(v) && v.every(isExperiment);
const load = () => readJson<Experiment[]>(KEY, [], isExperiments);
const blank = (): Experiment => ({ id: newId(), name: '', exposure: '', goal: '', variantKey: 'variant', control: 'A' });

export function Experiments({ version }: { version: number }) {
  const [list, setList] = useState<Experiment[]>(load);
  const [selected, setSelected] = useState<string | null>(list[0]?.id ?? null);
  const [editing, setEditing] = useState<Experiment | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const save = (l: Experiment[]) => {
    setList(l);
    writeJson(KEY, l);
  };

  const current = list.find((e) => e.id === selected) ?? null;


  const importJson = async (f: File) => {
    try {
      const v = JSON.parse(await f.text());
      if (!isExperiments(v)) throw new Error('Not a Shipstat experiments file');
      const byId = new Map(list.map((e) => [e.id, e]));
      v.forEach((e) => byId.set(e.id, e));
      save([...byId.values()]);
      setMsg(`Imported ${v.length} test(s).`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <div className="crumb"><a href="#overview">Overview</a> / A/B tests</div>
      <div className="head">
        <div>
          <h1>A/B tests</h1>
          <p>Compare variants set with <code>setContext({'{ variant }'})</code>: who saw an exposure event, and who then reached a goal.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" type="button" onClick={() => fileRef.current?.click()}>Import</button>
          <button className="btn" type="button" onClick={() => downloadJson('shipstat-experiments.json', list)} disabled={!list.length}>Export</button>
          <button className="btn primary" type="button" onClick={() => setEditing(blank())}>New test</button>
          <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} />
        </div>
      </div>
      {msg && <div className="card" style={{ marginBottom: 12, padding: '10px 14px' }}>{msg}</div>}

      {list.length > 0 && (
        <div className="exp-list">
          {list.map((e) => (
            <button key={e.id} type="button" className={e.id === selected ? 'tab on' : 'tab'} onClick={() => { setSelected(e.id); setEditing(null); }}>
              {e.name || `${e.exposure} → ${e.goal}`}
            </button>
          ))}
        </div>
      )}

      {editing && (
        <Editor
          value={editing}
          version={version}
          onCancel={() => setEditing(null)}
          onDelete={list.some((e) => e.id === editing.id) ? () => { save(list.filter((e) => e.id !== editing.id)); setEditing(null); setSelected(list.find((e) => e.id !== editing.id)?.id ?? null); } : undefined}
          onSave={(e) => {
            const exists = list.some((x) => x.id === e.id);
            save(exists ? list.map((x) => (x.id === e.id ? e : x)) : [...list, e]);
            setSelected(e.id);
            setEditing(null);
          }}
        />
      )}

      {!editing && current && <Results exp={current} version={version} onEdit={() => setEditing(current)} />}

      {!editing && !current && (
        <div className="card empty">
          <h2>No A/B test yet</h2>
          <p>A test needs an exposure event (e.g. <code>paywall_viewed</code>), a goal event (e.g. <code>purchase_done</code>) and the context key that holds the variant.</p>
          <button className="btn primary" type="button" onClick={() => setEditing(blank())}>Create a test</button>
        </div>
      )}
    </>
  );
}

function Editor({ value, version, onSave, onCancel, onDelete }: { value: Experiment; version: number; onSave: (e: Experiment) => void; onCancel: () => void; onDelete?: () => void }) {
  const [e, setE] = useState<Experiment>(value);
  const names = useAsync(eventNames, [version]);
  const versions = useAsync(() => distinctValues('app_version'), [version]);
  const valid = e.exposure && e.goal && e.variantKey && e.control;
  const set = (patch: Partial<Experiment>) => setE({ ...e, ...patch });
  return (
    <form className="card" onSubmit={(ev) => { ev.preventDefault(); if (valid) onSave({ ...e, name: e.name || `${e.exposure} → ${e.goal}` }); }}>
      <div className="form-grid">
        <label className="field">Name<input className="input" value={e.name} placeholder="New paywall" onChange={(x) => set({ name: x.target.value })} /></label>
        <label className="field">Exposure event
          <select className="input" value={e.exposure} onChange={(x) => set({ exposure: x.target.value })}>
            <option value="">Choose…</option>
            {(names.data ?? []).map((n) => <option key={n}>{n}</option>)}
          </select>
        </label>
        <label className="field">Goal event
          <select className="input" value={e.goal} onChange={(x) => set({ goal: x.target.value })}>
            <option value="">Choose…</option>
            {(names.data ?? []).map((n) => <option key={n}>{n}</option>)}
          </select>
        </label>
        <label className="field">Variant key (context or prop)<input className="input" value={e.variantKey} onChange={(x) => set({ variantKey: x.target.value })} /></label>
        <label className="field">Control value<input className="input" value={e.control} onChange={(x) => set({ control: x.target.value })} /></label>
        <label className="field">Versions (empty = all)
          <select className="input" multiple size={3} value={e.versions ?? []} onChange={(x) => set({ versions: [...x.target.selectedOptions].map((o) => o.value) })}>
            {(versions.data ?? []).map((v) => <option key={v}>{v}</option>)}
          </select>
        </label>
        <label className="field">Start (optional)<input className="input" type="date" value={e.start ?? ''} onChange={(x) => set({ start: x.target.value || undefined })} /></label>
        <label className="field">End (optional)<input className="input" type="date" value={e.end ?? ''} onChange={(x) => set({ end: x.target.value || undefined })} /></label>
      </div>
      <p className="faint" style={{ fontSize: 12.5, margin: '0 0 14px' }}>Tests are stored in this browser. Use Export to share them or keep them in your repo.</p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn primary" type="submit" disabled={!valid}>Save</button>
        <button className="btn" type="button" onClick={onCancel}>Cancel</button>
        <span className="spacer" />
        {onDelete && <button className="btn" type="button" onClick={onDelete}>Delete</button>}
      </div>
    </form>
  );
}

function Results({ exp, version, onEdit }: { exp: Experiment; version: number; onEdit: () => void }) {
  const data = useAsync(async () => {
    const [all, byVer, daily, perDay] = await Promise.all([arms(exp), armsByVersion(exp), cumulative(exp), exposuresPerDay(exp)]);
    const control = all.find((a) => a.v === exp.control);
    const others = all.filter((a) => a.v !== exp.control);
    const comps: Comparison[] = control ? others.map((a) => compare({ key: control.v, ...control }, { key: a.v, ...a })) : [];
    const versions = [...new Set(byVer.map((r) => r.ver))];
    const verRows = versions.flatMap((ver) => {
      const c = byVer.find((r) => r.ver === ver && r.v === exp.control);
      return byVer
        .filter((r) => r.ver === ver && r.v !== exp.control)
        .map((a) => ({ ver, a: c, b: a, cmp: c ? compare({ key: c.v, ...c }, { key: a.v, ...a }, 8000) : null }));
    });
    return { arms: all, control, comps, daily, perDay, verRows };
  }, [exp, version]);

  const d = data.data;
  if (data.error) return <div className="err">{data.error}</div>;
  // Never show the previous test's numbers under this test's labels.
  if (!d || data.loading) return <div className="loading">Crunching…</div>;
  if (!d.arms.length) return <div className="card empty"><h2>No exposure found</h2><p>No <code>{exp.exposure}</code> event carries a <code>{exp.variantKey}</code> value in the loaded data.</p><button className="btn" onClick={onEdit}>Edit test</button></div>;
  if (!d.control) return <div className="card empty"><h2>Control “{exp.control}” not found</h2><p>Values seen: {d.arms.map((a) => a.v).join(', ')}</p><button className="btn" onClick={onEdit}>Edit test</button></div>;

  const best = [...d.comps].sort((a, b) => b.probBetter - a.probBetter)[0];
  const win = best && best.probBetter >= THRESHOLD;
  const lose = best && best.probBetter <= 1 - THRESHOLD;
  const need = best ? exposuresNeeded(best) : null;
  const days = need && d.perDay ? Math.ceil(need / (d.perDay / Math.max(1, d.arms.length))) : null;

  const keys = d.arms.map((a) => a.v);
  const chart = { keys, points: d.daily.map((r) => ({ day: r.day, key: r.v, n: r.rate * 100 })) };
  const maxRate = Math.max(1, ...chart.points.map((p) => p.n));
  const pos = (v: number) => Math.max(0, Math.min(100, ((v + 0.5) / 1.5) * 100));

  return (
    <>
      <div className="card" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr) auto', padding: 0, marginBottom: 16 }}>
        {[['Exposure', exp.exposure], ['Goal', exp.goal], ['Variant from', exp.variantKey], ['Versions', exp.versions?.length ? exp.versions.join(', ') : 'all']].map(([k, v], i) => (
          <div key={k} style={{ padding: '14px 20px', borderLeft: i ? '1px solid var(--line)' : 0 }}><small className="faint" style={{ display: 'block', fontSize: 12 }}>{k}</small><code>{v}</code></div>
        ))}
        <div style={{ padding: '12px 16px' }}><button className="btn" type="button" onClick={onEdit}>Edit</button></div>
      </div>

      {best && (
        <div className={win ? 'verdict win' : lose ? 'verdict lose' : 'verdict wait'}>
          <div>
            <h2>
              {win && `${best.arm.key} converts better: ${fmtSignedPct(best.uplift)}`}
              {lose && `${best.arm.key} converts worse: ${fmtSignedPct(best.uplift)}`}
              {!win && !lose && 'No winner yet'}
            </h2>
            <p>
              Probability that {best.arm.key} beats {best.control.key}: {fmtPct(best.probBetter, 0)}.
              {!win && !lose && need !== null && (days !== null && days > 180
                ? ' The difference is too small to be detected in a reasonable time: treat the variants as equivalent.'
                : ` About ${fmtInt(need)} more exposures per variant needed${days ? ` (~${days} days at the current pace)` : ''}.`)}
            </p>
          </div>
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: `repeat(${d.arms.length}, minmax(0,1fr)) minmax(0,1.2fr)`, marginBottom: 16 }}>
        {d.arms.map((a, i) => (
          <div key={a.v} className="card" style={a.v === best?.arm.key ? { borderColor: 'var(--accent)' } : undefined}>
            <div className="ev" style={{ fontWeight: 600 }}><i style={{ width: 10, height: 10, borderRadius: 3, display: 'inline-block', background: color(i) }} />{a.v}{a.v === exp.control && <span className="faint"> · control</span>}</div>
            <div className="big">{fmtPct(a.exposed ? a.converted / a.exposed : 0)}</div>
            <div className="muted">conversion</div>
            <div className="stat-row"><div><b>{fmtInt(a.exposed)}</b>exposed</div><div><b>{fmtInt(a.converted)}</b>converted</div></div>
          </div>
        ))}
        {best && (
          <div className="card">
            <h2>{best.arm.key} vs {best.control.key}</h2>
            <div className="big" style={{ color: win ? 'var(--good)' : lose ? 'var(--bad)' : 'var(--text)' }}>{fmtSignedPct(best.uplift)}</div>
            <div className="muted">95 % interval: {fmtSignedPct(best.upliftLow)} to {fmtSignedPct(best.upliftHigh)}</div>
            <div className="ci">
              <div className="zero" style={{ left: `${pos(0)}%` }} />
              <div className="range" style={{ left: `${pos(best.upliftLow)}%`, width: `${Math.max(1, pos(best.upliftHigh) - pos(best.upliftLow))}%`, background: win ? '#9ad9bd' : lose ? '#f3b9a0' : '#f0d6a2' }} />
              <div className="pt" style={{ left: `${pos(best.uplift)}%`, background: win ? '#0e8a5f' : lose ? '#c2410c' : '#d4900f' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--faint)', fontSize: 11 }}><span>−50 %</span><span>0</span><span>+50 %</span><span>+100 %</span></div>
          </div>
        )}
      </div>

      <div className="two">
        <div className="card">
          <div className="card-head"><div><h2>Cumulative conversion by day of exposure</h2><p>Curves usually settle after about a week</p></div><Legend keys={keys} /></div>
          <Lines data={chart} height={230} fmt={(n) => n.toFixed(1) + ' %'} max={Math.ceil(maxRate * 1.2)} />
        </div>
        <div className="card">
          <div className="card-head"><div><h2>By app version</h2><p>Same test, split by the version at first exposure</p></div></div>
          <table>
            <thead><tr><th>Version</th><th>Variant</th><th className="num">{exp.control}</th><th className="num">Variant</th><th className="num">Uplift</th><th /></tr></thead>
            <tbody>
              {d.verRows.map((r) => (
                <tr key={r.ver + r.b.v}>
                  <td><code>{r.ver}</code></td>
                  <td>{r.b.v}</td>
                  <td className="num">{r.a ? fmtPct(r.a.converted / Math.max(1, r.a.exposed)) : '—'}</td>
                  <td className="num">{fmtPct(r.b.converted / Math.max(1, r.b.exposed))}</td>
                  <td className="num"><b>{r.cmp ? fmtSignedPct(r.cmp.uplift) : '—'}</b></td>
                  <td>{r.cmp && (r.cmp.probBetter >= THRESHOLD || r.cmp.probBetter <= 1 - THRESHOLD) ? <span className="pill good">Significant</span> : <span className="pill">Too early</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
