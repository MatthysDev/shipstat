import { useState } from 'react';
import { clean, docLine, setEventDoc, useCatalog, type EventDoc } from '../lib/catalog';

/** `<option>`s for an event picker, with the description as tooltip. */
export function EventOptions({ names }: { names: string[] }) {
  const cat = useCatalog();
  return names.map((n) => (
    <option key={n} value={n} title={docLine(cat.events[n]) || undefined}>{n}</option>
  ));
}

/** The description of the picked event, under a picker. */
export function EventHint({ name }: { name?: string }) {
  const cat = useCatalog();
  const line = name ? docLine(cat.events[name]) : '';
  return line ? <span className="event-hint">{line}</span> : null;
}

/** An event name as code, with its description on hover. */
export function EventName({ name, className }: { name: string; className?: string }) {
  const cat = useCatalog();
  return <code className={className} title={docLine(cat.events[name]) || undefined}>{name}</code>;
}

/** The catalog entry of one event: read as a sentence, edited inline. */
export function EventDocCard({ name, props, compact }: { name: string; props: string[]; compact?: boolean }) {
  const cat = useCatalog();
  const doc = cat.events[name] ?? {};
  const [draft, setDraft] = useState<EventDoc | null>(null);

  if (draft) {
    const set = (patch: Partial<EventDoc>) => setDraft({ ...draft, ...patch });
    const allProps = [...new Set([...props, ...Object.keys(draft.props ?? {})])];
    return (
      <form
        className={compact ? 'doc-form' : 'card doc-form'}
        onSubmit={(e) => {
          e.preventDefault();
          setEventDoc(name, draft);
          setDraft(null);
        }}
      >
        <label className="field">What it means<textarea className="input" rows={2} autoFocus value={draft.description ?? ''} onChange={(e) => set({ description: e.target.value })} placeholder="The paywall sheet was shown to the user." /></label>
        <div className="form-grid">
          <label className="field">When it fires<input className="input" value={draft.trigger ?? ''} onChange={(e) => set({ trigger: e.target.value })} placeholder="when the sheet finishes opening" /></label>
          <label className="field">Owner<input className="input" value={draft.owner ?? ''} onChange={(e) => set({ owner: e.target.value })} placeholder="Growth" /></label>
          <label className="field">Category<input className="input" value={draft.category ?? ''} onChange={(e) => set({ category: e.target.value })} placeholder="monetization" /></label>
        </div>
        {allProps.length > 0 && (
          <div className="field">Properties
            <div className="doc-props">
              {allProps.map((p) => (
                <label key={p}>
                  <code>{p}</code>
                  <input className="input" value={draft.props?.[p] ?? ''} onChange={(e) => set({ props: { ...draft.props, [p]: e.target.value } })} placeholder="What this value holds" />
                </label>
              ))}
            </div>
          </div>
        )}
        <div className="row-actions">
          <button className="btn primary" type="submit">Save</button>
          <button className="btn" type="button" onClick={() => setDraft(null)}>Cancel</button>
          <span className="faint small">Saved in this browser and in the workspace export.</span>
        </div>
      </form>
    );
  }

  const meta = [doc.category, doc.owner && `owned by ${doc.owner}`].filter(Boolean);
  const propDocs = Object.entries(doc.props ?? {});
  return (
    <div className={compact ? 'doc' : 'card doc'}>
      <div className="doc-main">
        {doc.description ? <p className="doc-desc">{doc.description}</p> : <p className="doc-desc missing">No description yet. Say what this event means so your team reads the numbers the same way.</p>}
        {(doc.trigger || meta.length > 0) && (
          <p className="doc-meta">
            {doc.trigger && <span>Fires {doc.trigger.replace(/^fires\s+/i, '')}</span>}
            {meta.map((m) => <span key={m} className="pill">{m}</span>)}
          </p>
        )}
        {propDocs.length > 0 && (
          <dl className="doc-prop-list">
            {propDocs.map(([k, t]) => (
              <div key={k}><dt><code>{k}</code></dt><dd>{t}</dd></div>
            ))}
          </dl>
        )}
      </div>
      <button className="btn" type="button" onClick={() => setDraft(clean(doc))}>{doc.description ? 'Edit' : 'Describe'}</button>
    </div>
  );
}
