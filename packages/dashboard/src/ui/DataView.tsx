import { useState } from 'react';
import { clearEvents, countEvents, importFile, insertEvents } from '../data/db';
import { syncApi, syncSupabase, type Project, type Source } from '../data/sources';
import { demoEvents } from '../lib/demo';
import { fmtAgo, fmtInt } from '../lib/format';
import type { Loaded } from './App';

type Tab = 'api' | 'file' | 'supabase' | 'demo';

export function DataView({ projects, setProjects, loaded, onLoaded }: { projects: Project[]; setProjects: (p: Project[]) => void; loaded: Loaded; onLoaded: (source?: string) => Promise<void> }) {
  const saved = projects[0];
  const [tab, setTab] = useState<Tab>((saved?.source.kind as Tab) ?? 'api');
  const [api, setApi] = useState(saved?.source.kind === 'api' ? saved.source : { kind: 'api' as const, url: 'http://localhost:8787/events/export', headerName: 'Authorization', headerValue: '' });
  const [supa, setSupa] = useState(saved?.source.kind === 'supabase' ? saved.source : { kind: 'supabase' as const, url: '', key: '', table: 'events' });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [ms, setMs] = useState<number | null>(null);

  const remember = (source: Source) => setProjects([{ id: saved?.id ?? 'default', name: saved?.name ?? 'My app', source, lastSync: new Date().toISOString() }]);

  const run = async (label: string, fn: () => Promise<number>, sourceLabel: string, source: Source) => {
    setBusy(label);
    setError(null);
    const t0 = performance.now();
    try {
      await fn();
      setMs(performance.now() - t0);
      remember(source);
      await onLoaded(sourceLabel);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const loadApi = () =>
    run('Loading from your API…', async () => (await syncApi(api, (n) => setBusy(`Loading from your API… ${fmtInt(n)} events`))).added, safeHost(api.url), api);

  const loadSupabase = () =>
    run('Loading from Supabase…', async () => (await syncSupabase(supa, (n) => setBusy(`Loading from Supabase… ${fmtInt(n)} events`))).added, safeHost(supa.url), supa);

  const loadFile = (f: File) => run(`Importing ${f.name}…`, () => importFile(f), f.name, { kind: 'file', fileName: f.name });

  const loadDemo = () => run('Generating demo data…', () => insertEvents(demoEvents()), 'demo data', { kind: 'demo' });

  const clear = async () => {
    await clearEvents();
    await onLoaded('');
    setMs(null);
  };

  return (
    <>
      <div className="head">
        <div>
          <h1>Data &amp; SDK</h1>
          <p>This dashboard stores nothing. It loads your events and analyses them in your browser with DuckDB.</p>
        </div>
      </div>
      <div className="cols">
        <section>
          <p className="sec-title">1 · Send events from your app</p>
          <div className="card">
            <h2>The module posts batches to your API</h2>
            <p className="muted" style={{ margin: '4px 0 14px' }}>Native (Swift / Kotlin): events are written to disk and sent in the background, with your own headers.</p>
            <pre className="code">{`npx expo install shipstat

import Shipstat from 'shipstat';

Shipstat.init({
  endpoint: 'https://api.example.com/events',
  headers: { Authorization: \`Bearer \${token}\` },
});

Shipstat.setContext({ variant: 'B', feature: 'paywall_v2' });
Shipstat.track('paywall_viewed', { placement: 'onboarding_end' });`}</pre>
            <p className="sec-title" style={{ marginTop: 18 }}>What your API receives</p>
            <pre className="code">{`POST /events
{ "schema": 1, "sent_at": "…", "events": [{
    "id": "6f1c…", "name": "paywall_viewed",
    "ts": "2026-11-16T09:12:04.120Z", "anon_id": "a1f9…", "user_id": null,
    "props": { "placement": "onboarding_end" },
    "context": { "variant": "B", "feature": "paywall_v2",
      "app_version": "2.3.0", "build": "412", "platform": "ios", … } }] }`}</pre>
            <p className="faint" style={{ fontSize: 12.5, margin: '12px 0 0' }}>No API yet? <code>examples/dev-server</code> in the repo receives and serves events in one file.</p>
          </div>
        </section>

        <section>
          <p className="sec-title">2 · Load events to analyse them</p>
          <div className="card">
            <div className="tabs">
              {([['api', 'Your API'], ['file', 'File import'], ['supabase', 'Supabase'], ['demo', 'Demo data']] as [Tab, string][]).map(([t, l]) => (
                <button key={t} type="button" className={t === tab ? 'tab on' : 'tab'} onClick={() => setTab(t)}>{l}</button>
              ))}
            </div>

            {tab === 'api' && (
              <form onSubmit={(e) => { e.preventDefault(); loadApi(); }}>
                <label className="field">Read endpoint<input className="input" value={api.url} onChange={(e) => setApi({ ...api, url: e.target.value })} placeholder="https://api.example.com/events/export" /></label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 8 }}>
                  <label className="field">Header<input className="input" value={api.headerName} onChange={(e) => setApi({ ...api, headerName: e.target.value })} /></label>
                  <label className="field">Value<input className="input" type="password" autoComplete="off" value={api.headerValue} onChange={(e) => setApi({ ...api, headerValue: e.target.value })} placeholder="Bearer …" /></label>
                </div>
                <p className="faint" style={{ fontSize: 12.5, margin: '0 0 12px' }}>Called as <code>GET url?since=&lt;cursor&gt;&amp;limit=5000</code>, returning <code>{'{ events, next_cursor }'}</code>. Saved in this browser only.</p>
                <button className="btn primary" type="submit" disabled={!!busy || !api.url}>Load</button>
              </form>
            )}

            {tab === 'file' && (
              <label
                className={over ? 'drop over' : 'drop'}
                onDragOver={(e) => { e.preventDefault(); setOver(true); }}
                onDragLeave={() => setOver(false)}
                onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) loadFile(f); }}
              >
                <input type="file" hidden accept=".csv,.json,.ndjson,.jsonl,.parquet" onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0])} />
                <b style={{ display: 'block', fontSize: 15, marginBottom: 4 }}>Drop an export of your events table</b>
                <span className="muted">CSV, JSON, NDJSON or Parquet · columns id, name, ts, anon_id, user_id, props, context</span>
              </label>
            )}

            {tab === 'supabase' && (
              <form onSubmit={(e) => { e.preventDefault(); loadSupabase(); }}>
                <label className="field">Project URL<input className="input" value={supa.url} onChange={(e) => setSupa({ ...supa, url: e.target.value })} placeholder="https://xyz.supabase.co" /></label>
                <label className="field">Read-only key<input className="input" type="password" autoComplete="off" value={supa.key} onChange={(e) => setSupa({ ...supa, key: e.target.value })} /></label>
                <label className="field">Table<input className="input" value={supa.table} onChange={(e) => setSupa({ ...supa, table: e.target.value })} /></label>
                <button className="btn primary" type="submit" disabled={!!busy || !supa.url || !supa.key}>Load</button>
              </form>
            )}

            {tab === 'demo' && (
              <div>
                <p className="muted" style={{ marginTop: 0 }}>About 60 000 synthetic events from a fitness app: 3 versions, a paywall A/B test, 30 days.</p>
                <button className="btn primary" type="button" onClick={loadDemo} disabled={!!busy}>Load demo data</button>
              </div>
            )}

            {busy && <div className="loading" style={{ padding: '14px 0 0', textAlign: 'left' }}>{busy}</div>}
            {error && <div className="err">{error}</div>}

            {loaded.count > 0 && !busy && (
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', border: '1px solid #bfe8d6', background: 'var(--good-soft)', borderRadius: 9, padding: '12px 14px', marginTop: 14 }}>
                <div style={{ flex: 1 }}>
                  <b>{fmtInt(loaded.count)} events loaded{loaded.source ? ` from ${loaded.source}` : ''}</b>
                  <div className="muted" style={{ fontSize: 12.5 }}>{loaded.at ? `Updated ${fmtAgo(loaded.at)}` : ''}{ms !== null ? ` · loaded in ${(ms / 1000).toFixed(1)} s` : ''}</div>
                </div>
                <button className="btn" type="button" onClick={clear}>Clear</button>
              </div>
            )}
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <h2>Host this dashboard yourself</h2>
            <p className="muted" style={{ margin: '4px 0 14px' }}>It is a static site: use the public one, or deploy your own copy anywhere.</p>
            <pre className="code">{`# dist/ for Vercel, Netlify, Cloudflare Pages…
pnpm --filter shipstat-dashboard build

# or as a container
docker build -t shipstat-dashboard -f packages/dashboard/Dockerfile .
docker run -p 8080:80 shipstat-dashboard`}</pre>
          </div>
        </section>
      </div>
    </>
  );
}

function safeHost(u: string): string {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
}

export { countEvents };
