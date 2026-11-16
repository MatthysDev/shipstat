import { useState } from 'react';
import { clearCache, saveCache } from '../../data/cache';
import { clearEvents, importFile, insertEvents, stitchIdentities } from '../../data/db';
import { syncApi, syncSupabase, type ApiSource, type SupabaseSource } from '../../data/sources';
import { demoEvents } from '../../lib/demo';
import { fmtAgo, fmtInt } from '../../lib/format';
import { readJson, writeJson } from '../../lib/storage';
import type { LiveControl, Loaded } from '../App';

type Tab = 'api' | 'file' | 'supabase' | 'demo';

interface Saved {
  tab: Tab;
  api: ApiSource;
  supabase: SupabaseSource;
}

const KEY = 'shipstat.sources.v1';
const DEFAULTS: Saved = {
  tab: 'api',
  api: { url: 'http://localhost:8787/events/export', headerName: 'Authorization', headerValue: '' },
  supabase: { url: '', key: '', table: 'events' },
};
const isSaved = (v: unknown): v is Saved => !!v && typeof (v as Saved).tab === 'string' && !!(v as Saved).api && !!(v as Saved).supabase;

const SDK_SNIPPET = `npx expo install shipstat

import Shipstat from 'shipstat';

Shipstat.init({ endpoint: 'http://localhost:8787/events' });

Shipstat.setContext({ variant: 'B' });
Shipstat.track('paywall_viewed', { placement: 'onboarding_end' });`;

const LOCAL_SNIPPET = `npx shipstat-dashboard
# receives events on :8787/events and serves this dashboard, live`;

const PAYLOAD_SNIPPET = `POST /events
{ "schema": 1, "sent_at": "…", "events": [{
    "id": "6f1c…", "name": "paywall_viewed",
    "ts": "2026-11-16T09:12:04.120Z", "anon_id": "a1f9…", "user_id": null,
    "props": { "placement": "onboarding_end" },
    "context": { "variant": "B", "feature": "paywall_v2",
      "app_version": "2.3.0", "build": "412", "platform": "ios", … } }] }`;

const HOSTING_SNIPPET = `# A static dist/ for Vercel, Netlify, GitHub Pages…
pnpm --filter shipstat-dashboard build

# or as a container
docker build -t shipstat-dashboard -f packages/dashboard/Dockerfile .
docker run -p 8080:80 shipstat-dashboard`;

export function DataView({ loaded, onLoaded, live }: { loaded: Loaded; onLoaded: (source?: string) => Promise<void>; live: LiveControl }) {
  const [saved, setSaved] = useState<Saved>(() => readJson(KEY, DEFAULTS, isSaved));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [elapsed, setElapsed] = useState<number | null>(null);

  const update = (patch: Partial<Saved>) => {
    const next = { ...saved, ...patch };
    setSaved(next);
    // Credentials stay in this browser; they are only ever sent to the source itself.
    writeJson(KEY, next);
  };

  const run = async (label: string, source: string, load: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    const t0 = performance.now();
    try {
      await load();
      await stitchIdentities();
      setElapsed(performance.now() - t0);
      await onLoaded(source);
      await saveCache(source);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const progress = (what: string) => (n: number) => setBusy(`Loading from ${what}… ${fmtInt(n)} events`);
  const loadApi = () => run('Loading from your API…', host(saved.api.url), () => syncApi(saved.api, progress('your API')));
  const loadSupabase = () => run('Loading from Supabase…', host(saved.supabase.url), () => syncSupabase(saved.supabase, progress('Supabase')));
  const loadFile = (f: File) => run(`Importing ${f.name}…`, f.name, () => importFile(f));
  const loadDemo = () => run('Generating demo data…', 'demo data', () => insertEvents(demoEvents()));

  const clear = async () => {
    await clearEvents();
    await clearCache();
    setElapsed(null);
    await onLoaded('');
  };

  const tabs: [Tab, string][] = [['api', 'Your API'], ['file', 'File import'], ['supabase', 'Supabase'], ['demo', 'Demo data']];

  return (
    <>
      <div className="head">
        <div>
          <h1>Data &amp; SDK</h1>
          <p>This dashboard has no server. It loads your events and analyses them in your browser with DuckDB.</p>
        </div>
      </div>
      <div className="cols">
        <section>
          <p className="sec-title">1 · Send events from your app</p>
          <div className="card">
            <h2>Three lines in your app</h2>
            <p className="muted lead">Native (Swift / Kotlin): events are written to disk and sent in batches in the background.</p>
            <pre className="code">{SDK_SNIPPET}</pre>
            <p className="sec-title" style={{ marginTop: 18 }}>No backend yet</p>
            <pre className="code">{LOCAL_SNIPPET}</pre>
            <p className="sec-title" style={{ marginTop: 18 }}>What your API receives</p>
            <pre className="code">{PAYLOAD_SNIPPET}</pre>
            <p className="faint small">In production, point <code>endpoint</code> at your own API and add your auth header.</p>
          </div>
        </section>

        <section>
          <p className="sec-title">2 · Load events to analyse them</p>
          <div className="card">
            <div className="tabs">
              {tabs.map(([t, l]) => <button key={t} type="button" className={t === saved.tab ? 'tab on' : 'tab'} onClick={() => update({ tab: t })}>{l}</button>)}
            </div>

            {saved.tab === 'api' && (
              <form onSubmit={(e) => { e.preventDefault(); loadApi(); }}>
                <label className="field">Read endpoint<input className="input" value={saved.api.url} onChange={(e) => update({ api: { ...saved.api, url: e.target.value } })} placeholder="https://api.example.com/events/export" /></label>
                <div className="form-grid header-grid">
                  <label className="field">Header<input className="input" value={saved.api.headerName} onChange={(e) => update({ api: { ...saved.api, headerName: e.target.value } })} /></label>
                  <label className="field">Value<input className="input" type="password" autoComplete="off" value={saved.api.headerValue} onChange={(e) => update({ api: { ...saved.api, headerValue: e.target.value } })} placeholder="Bearer …" /></label>
                </div>
                <p className="faint small">Called as <code>GET url?since=&lt;cursor&gt;&amp;limit=5000</code>, returning <code>{'{ events, next_cursor }'}</code>. Saved in this browser only.</p>
                <div className="row-actions">
                  <button className="btn primary" type="submit" disabled={!!busy || !saved.api.url}>Load</button>
                  {loaded.live ? (
                    <button className="btn" type="button" onClick={live.stop}><span className="dot live" />Stop live</button>
                  ) : (
                    <button className="btn" type="button" disabled={!!busy || !saved.api.url} onClick={() => live.start(saved.api, host(saved.api.url))}>Follow live</button>
                  )}
                </div>
              </form>
            )}

            {saved.tab === 'file' && (
              <label
                className={over ? 'drop over' : 'drop'}
                onDragOver={(e) => { e.preventDefault(); setOver(true); }}
                onDragLeave={() => setOver(false)}
                onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) loadFile(f); }}
              >
                <input type="file" hidden accept=".csv,.json,.ndjson,.jsonl,.parquet" onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0])} />
                <b>Drop an export of your events table</b>
                <span className="muted">CSV, JSON, NDJSON or Parquet · columns id, name, ts, anon_id, user_id, props, context</span>
              </label>
            )}

            {saved.tab === 'supabase' && (
              <form onSubmit={(e) => { e.preventDefault(); loadSupabase(); }}>
                <label className="field">Project URL<input className="input" value={saved.supabase.url} onChange={(e) => update({ supabase: { ...saved.supabase, url: e.target.value } })} placeholder="https://xyz.supabase.co" /></label>
                <label className="field">Read-only key<input className="input" type="password" autoComplete="off" value={saved.supabase.key} onChange={(e) => update({ supabase: { ...saved.supabase, key: e.target.value } })} /></label>
                <label className="field">Table<input className="input" value={saved.supabase.table} onChange={(e) => update({ supabase: { ...saved.supabase, table: e.target.value } })} /></label>
                <button className="btn primary" type="submit" disabled={!!busy || !saved.supabase.url || !saved.supabase.key}>Load</button>
              </form>
            )}

            {saved.tab === 'demo' && (
              <div>
                <p className="muted" style={{ marginTop: 0 }}>About 140 000 synthetic events from a fitness app over 45 days: three versions, a paywall A/B test, an onboarding funnel.</p>
                <button className="btn primary" type="button" onClick={loadDemo} disabled={!!busy}>Load demo data</button>
              </div>
            )}

            {busy && <div className="loading inline">{busy}</div>}
            {error && <div className="err">{error}</div>}

            {loaded.count > 0 && !busy && (
              <div className="status">
                <div>
                  <b>{fmtInt(loaded.count)} events loaded{loaded.source ? ` from ${loaded.source}` : ''}</b>
                  <div className="muted small">{loaded.at ? `Updated ${fmtAgo(loaded.at)}` : ''}{elapsed !== null ? ` · loaded in ${(elapsed / 1000).toFixed(1)} s` : ''} · kept in this browser between visits</div>
                </div>
                <button className="btn" type="button" onClick={clear}>Clear</button>
              </div>
            )}
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <h2>Host this dashboard yourself</h2>
            <p className="muted lead">It is a static site: use the public one, or deploy your own copy anywhere.</p>
            <pre className="code">{HOSTING_SNIPPET}</pre>
          </div>
        </section>
      </div>
    </>
  );
}

function host(u: string): string {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
}
