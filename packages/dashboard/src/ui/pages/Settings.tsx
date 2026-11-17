import { useRef, useState } from 'react';
import { loadBoards } from '../../lib/boards';
import { accentTokens, brandingStore, cleanBranding, DEFAULT_ACCENT, isHex, MIN_CONTRAST, useBranding, type Branding } from '../../lib/branding';
import { useCatalog } from '../../lib/catalog';
import { downloadJson } from '../../lib/storage';
import { applyWorkspace, exportWorkspace, parseWorkspace } from '../../lib/workspace';
import { Logo } from '../Logo';

const PRESETS = ['#f2542d', '#2563eb', '#0f9d6e', '#7c3aed', '#db2777', '#14150f'];
const MAX_LOGO = 200_000;

export interface SharedInfo {
  from: string;
  applied: boolean;
}

export function Settings({ shared }: { shared: SharedInfo | null }) {
  const b = useBranding();
  const cat = useCatalog();
  const boards = loadBoards();
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const logoRef = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<Branding>) => brandingStore.set({ ...b, ...patch });
  const accent = b.accent ?? DEFAULT_ACCENT;
  const [hexDraft, setHexDraft] = useState(accent);

  const pickLogo = (f: File) => {
    if (f.size > MAX_LOGO) return setNotice(`This image is ${Math.round(f.size / 1000)} kB: use one under ${MAX_LOGO / 1000} kB, or a URL.`);
    const r = new FileReader();
    r.onload = () => set({ logo: String(r.result) });
    r.readAsDataURL(f);
  };

  const importWorkspace = async (f: File) => {
    try {
      const ws = parseWorkspace(JSON.parse(await f.text()));
      if (!ws) throw new Error('No Shipstat workspace or tracking plan in this file.');
      applyWorkspace(ws);
      setHexDraft(brandingStore.get().accent ?? DEFAULT_ACCENT);
      setNotice(`Imported ${ws.boards.length} board(s), ${Object.keys(ws.catalog.events).length} event description(s)${Object.keys(ws.branding).length ? ' and the branding' : ''}.`);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  };

  const described = Object.values(cat.events).filter((d) => d.description).length;

  return (
    <>
      <div className="head">
        <div>
          <h1>Workspace</h1>
          <p>Make this dashboard your team's: its name, colors, boards and event catalog, shared as one file.</p>
        </div>
      </div>
      {notice && <div className="card notice">{notice}</div>}

      <div className="cols">
        <section>
          <p className="sec-title">Branding</p>
          <div className="card">
            <label className="field">Workspace name
              <input className="input" value={b.name ?? ''} placeholder="Shipstat" maxLength={60} onChange={(e) => set({ name: e.target.value || undefined })} />
            </label>

            <div className="field">Accent color
              <div className="row-actions">
                <input type="color" className="swatch-input" value={accent} onChange={(e) => { set({ accent: e.target.value }); setHexDraft(e.target.value); }} aria-label="Accent color" />
                <input className="input mono" style={{ width: 110 }} value={hexDraft} onChange={(e) => { setHexDraft(e.target.value); if (isHex(e.target.value)) set({ accent: e.target.value.toLowerCase() }); }} aria-label="Accent hex" />
                {PRESETS.map((c) => (
                  <button key={c} type="button" className={c === accent ? 'swatch on' : 'swatch'} style={{ background: c }} title={c} onClick={() => { set({ accent: c }); setHexDraft(c); }} />
                ))}
              </div>
              <Contrast hex={accent} />
            </div>

            <div className="field">Logo
              <div className="row-actions">
                <span className="logo-preview">{b.logo ? <img src={b.logo} alt="" /> : <Logo size={32} />}</span>
                <input className="input" style={{ flex: 1, minWidth: 180 }} value={b.logo?.startsWith('data:') ? '(uploaded image)' : b.logo ?? ''} placeholder="https://… or upload" onChange={(e) => set({ logo: cleanBranding({ logo: e.target.value }).logo })} />
                <button className="btn" type="button" onClick={() => logoRef.current?.click()}>Upload</button>
                {b.logo && <button className="btn" type="button" onClick={() => set({ logo: undefined })}>Remove</button>}
                <input ref={logoRef} type="file" accept="image/png,image/svg+xml,image/jpeg,image/webp" hidden onChange={(e) => { if (e.target.files?.[0]) pickLogo(e.target.files[0]); e.target.value = ''; }} />
              </div>
              <span className="faint" style={{ fontWeight: 400 }}>Square works best. Uploaded images are kept in the workspace file (under 200 kB).</span>
            </div>

            <label className="field">Default board
              <select className="input" value={b.defaultBoard ?? ''} onChange={(e) => set({ defaultBoard: e.target.value || undefined })}>
                <option value="">The first board</option>
                {boards.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </label>
            {Object.keys(b).length > 0 && <button className="link" type="button" onClick={() => { brandingStore.set({}); setHexDraft(DEFAULT_ACCENT); }}>Reset branding</button>}
          </div>
        </section>

        <section>
          <p className="sec-title">Share with your team</p>
          <div className="card">
            <h2>One file for everything</h2>
            <p className="muted lead">
              {boards.length} board{boards.length === 1 ? '' : 's'}, {described} described event{described === 1 ? '' : 's'} and the branding. No data, no credentials: events stay where they are.
            </p>
            <div className="row-actions">
              <button className="btn primary" type="button" onClick={() => downloadJson('shipstat-workspace.json', exportWorkspace())}>Export workspace</button>
              <button className="btn" type="button" onClick={() => fileRef.current?.click()}>Import workspace</button>
              <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { if (e.target.files?.[0]) importWorkspace(e.target.files[0]); e.target.value = ''; }} />
            </div>
            <p className="faint small">Importing merges: boards with the same id and described events are replaced, the rest is kept.</p>
            {shared && (
              <div className="status">
                <div>
                  <b>Shared workspace from {shared.from}</b>
                  <div className="muted small">{shared.applied ? 'Applied on this visit: it changed since the last one.' : 'Already applied. Your local edits are kept until the shared file changes.'}</div>
                </div>
              </div>
            )}
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <h2>Serve it with the dashboard</h2>
            <p className="muted lead">Everyone who opens the link gets the same boards, catalog and branding. Edits to the file show on reload.</p>
            <pre className="code">{`npx shipstat-dashboard --workspace shipstat-workspace.json

# static hosting: next to index.html, shipstat.config.json
{ "workspaceUrl": "./shipstat-workspace.json" }`}</pre>
            <div className="row-actions" style={{ marginTop: 14 }}>
              <ShareButton label="Copy share link" url={location.origin + location.pathname} />
            </div>
          </div>
        </section>
      </div>
    </>
  );
}

/** Light and dark swatches of the accent as it will be drawn, with its contrast. */
function Contrast({ hex }: { hex: string }) {
  if (!isHex(hex)) return null;
  return (
    <div className="contrast">
      {(['light', 'dark'] as const).map((theme) => {
        const t = accentTokens(hex, theme);
        const adjusted = t.picked < MIN_CONTRAST;
        return (
          <div key={theme} className={`contrast-card ${theme}`}>
            <i style={{ background: t.accent }} />
            <span>
              <b>{theme === 'light' ? 'Light' : 'Dark'}</b> {adjusted ? `adjusted to ${t.accent} to stay readable` : `${t.picked.toFixed(1)}:1, reads well`}
            </span>
          </div>
        );
      })}
    </div>
  );
}

const isLocal = () => /^(localhost|127\.|\[::1\]|0\.0\.0\.0)/.test(location.hostname);

export function ShareButton({ url, label = 'Copy link' }: { url: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <>
      <button
        className="btn"
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(url);
          setDone(true);
          setTimeout(() => setDone(false), 2000);
        }}
      >
        {done ? 'Link copied' : label}
      </button>
      {done && isLocal() && <span className="faint small">This address only works on your machine: host the dashboard to share it.</span>}
    </>
  );
}
