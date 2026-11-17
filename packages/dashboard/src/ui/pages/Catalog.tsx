import { Fragment, useRef, useState } from 'react';
import { catalogStats } from '../../data/queries';
import { catalogStore, isDocumented, mergeCatalog, parseCatalog, setKeyDoc, useCatalog } from '../../lib/catalog';
import { fmtAgo, fmtInt } from '../../lib/format';
import { downloadJson } from '../../lib/storage';
import { EventDocCard } from '../EventDoc';
import { useAsync } from '../hooks';

const CONTEXT_KEYS = ['app_version', 'build', 'platform', 'variant', 'feature', 'os_version', 'device_model', 'locale'];

export function Catalog({ version }: { version: number }) {
  const cat = useCatalog();
  const stats = useAsync(catalogStats, [version]);
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'missing'>('all');
  const [q, setQ] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const seen = stats.data ?? [];
  // Events of the plan that never arrived are listed too: maybe not shipped yet, maybe broken.
  const planned = Object.keys(cat.events).filter((n) => !seen.some((s) => s.name === n)).map((name) => ({ name, total: 0, users: 0, last: null as Date | null, keys: Object.keys(cat.events[name].props ?? {}) }));
  const rows = [...seen, ...planned];
  const missing = rows.filter((r) => !isDocumented(cat.events[r.name]));
  const needle = q.trim().toLowerCase();
  const shown = (filter === 'missing' ? missing : rows).filter((r) => {
    if (!needle) return true;
    const d = cat.events[r.name];
    return [r.name, d?.description, d?.category, d?.owner].some((s) => s?.toLowerCase().includes(needle));
  });

  const loadPlan = async (f: File) => {
    try {
      const plan = parseCatalog(JSON.parse(await f.text()));
      if (!plan) throw new Error('No tracking plan in this file: expected { "events": { "name": { "description": … } } }.');
      catalogStore.set(mergeCatalog(catalogStore.get(), plan));
      setNotice(`Loaded ${Object.keys(plan.events).length} event descriptions from ${f.name}.`);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <div className="head">
        <div>
          <h1>Event catalog</h1>
          <p>What each event means and when it fires, so everyone reads the numbers the same way.</p>
        </div>
        <div className="row-actions">
          <button className="btn" type="button" onClick={() => fileRef.current?.click()}>Load tracking plan</button>
          <button className="btn" type="button" onClick={() => downloadJson('shipstat-tracking-plan.json', cat)}>Export plan</button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { if (e.target.files?.[0]) loadPlan(e.target.files[0]); e.target.value = ''; }} />
        </div>
      </div>
      {notice && <div className="card notice">{notice}</div>}

      <div className="filters">
        <div className="seg" role="group" aria-label="Show">
          <button type="button" className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>All {rows.length}</button>
          <button type="button" className={filter === 'missing' ? 'on' : ''} onClick={() => setFilter('missing')}>Undescribed {missing.length}</button>
        </div>
        <input className="chip search" type="search" placeholder="Search events, owners, categories" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="spacer" />
        {rows.length > 0 && <span className="muted">{fmtInt(rows.length - missing.length)} of {fmtInt(rows.length)} described</span>}
      </div>
      {stats.error && <div className="err">{stats.error}</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <table className="catalog">
          <thead><tr><th>Event</th><th>What it means</th><th>Owner</th><th className="num">Events</th><th className="num">Users</th><th className="num">Last seen</th></tr></thead>
          <tbody>
            {shown.map((r) => {
              const doc = cat.events[r.name];
              const isOpen = open === r.name;
              return (
                <Fragment key={r.name}>
                  <tr className={isOpen ? 'row-link open' : 'row-link'} onClick={() => setOpen(isOpen ? null : r.name)}>
                    <td>
                      <span className="ev"><code>{r.name}</code></span>
                      {doc?.category && <span className="pill cat">{doc.category}</span>}
                    </td>
                    <td className="cat-desc">{doc?.description ? doc.description : <span className="pill warn">No description</span>}</td>
                    <td className="muted">{doc?.owner ?? ''}</td>
                    <td className="num">{r.total ? fmtInt(r.total) : <span className="faint">not seen</span>}</td>
                    <td className="num">{r.users ? fmtInt(r.users) : ''}</td>
                    <td className="num faint">{r.last ? fmtAgo(r.last) : ''}</td>
                  </tr>
                  {isOpen && (
                    <tr className="doc-row">
                      <td colSpan={6}>
                        <EventDocCard name={r.name} props={r.keys} compact />
                        <a className="faint small" href={`#event/${encodeURIComponent(r.name)}`}>Open {r.name} →</a>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {!shown.length && <tr><td colSpan={6} className="muted">{filter === 'missing' ? 'Every event has a description.' : 'No event matches.'}</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="card-head"><div><h2>Context keys</h2><p>Sent with every event. Describe the ones your team splits by.</p></div></div>
        <div className="doc-props">
          {[...new Set([...CONTEXT_KEYS, ...Object.keys(cat.keys)])].map((k) => (
            <label key={k + (cat.keys[k] ?? '')}>
              <code>{k}</code>
              <input className="input" defaultValue={cat.keys[k] ?? ''} placeholder="What this key holds" onBlur={(e) => e.target.value !== (cat.keys[k] ?? '') && setKeyDoc(k, e.target.value)} />
            </label>
          ))}
        </div>
      </div>
    </>
  );
}
