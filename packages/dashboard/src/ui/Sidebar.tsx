import type { ReactNode } from 'react';
import { fmtAgo, fmtInt } from '../lib/format';
import type { Route } from '../lib/router';
import type { Loaded } from './App';

const NAV: { page: Route['page']; label: string; section?: string; icon: ReactNode }[] = [
  { page: 'boards', label: 'Boards', section: 'Stats', icon: <><rect x="2" y="2" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.6" fill="none" /><rect x="9" y="2" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.6" fill="none" /><rect x="2" y="9" width="12" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.6" fill="none" /></> },
  { page: 'overview', label: 'Overview', icon: <path d="M2 13V8m4 5V4m4 9V6m4 7V2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /> },
  { page: 'event', label: 'Events', icon: <path d="M2 8h3l2-5 2 10 2-5h3" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /> },
  { page: 'experiments', label: 'A/B tests', icon: <><rect x="1.5" y="3" width="5.5" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.6" fill="none" /><rect x="9" y="3" width="5.5" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.6" fill="none" /></> },
  { page: 'data', label: 'Data & SDK', section: 'Project', icon: <><circle cx="8" cy="8" r="2.4" stroke="currentColor" strokeWidth="1.6" fill="none" /><path d="M8 1.5v2m0 9v2M1.5 8h2m9 0h2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></> },
];

export function Sidebar({ route, loaded }: { route: Route; loaded: Loaded }) {
  return (
    <aside className="side">
      <a className="brand" href="#boards">
        <span className="brand-mark">
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><rect x="1" y="6" width="2.4" height="5" rx=".6" fill="currentColor" /><rect x="4.8" y="3.5" width="2.4" height="7.5" rx=".6" fill="currentColor" /><rect x="8.6" y="1" width="2.4" height="10" rx=".6" fill="currentColor" /></svg>
        </span>
        Shipstat
      </a>
      {NAV.map((it) => (
        <div key={it.page}>
          {it.section && <div className="nav-label">{it.section}</div>}
          <a className={route.page === it.page ? 'nav on' : 'nav'} href={`#${it.page}`}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>{it.icon}</svg>
            {it.label}
          </a>
        </div>
      ))}
      <div className="side-foot">
        {loaded.live && (
          <div className="live-tag">
            <span className="dot live" />
            Live
            {loaded.lastAdded ? <span key={loaded.version} className="flash">+{fmtInt(loaded.lastAdded)}</span> : null}
          </div>
        )}
        {loaded.count > 0 ? (
          <>
            <b className="mono">{fmtInt(loaded.count)}</b> events
            {loaded.source && <> · <span className="mono">{loaded.source}</span></>}
            <br />
            In your browser{loaded.at ? ` · ${fmtAgo(loaded.at)}` : ''}
          </>
        ) : (
          'Nothing loaded. Your data never leaves your browser.'
        )}
      </div>
    </aside>
  );
}
