import { fmtAgo, fmtInt } from '../lib/format';
import type { Loaded, Route } from './App';

const items: { page: Route['page']; label: string; icon: React.ReactNode; section?: string }[] = [
  { page: 'overview', label: 'Overview', section: 'Stats', icon: <path d="M2 13V8m4 5V4m4 9V6m4 7V2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /> },
  { page: 'event', label: 'Events', icon: <path d="M2 8h3l2-5 2 10 2-5h3" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /> },
  { page: 'experiments', label: 'A/B tests', icon: <><rect x="1.5" y="3" width="5.5" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.6" fill="none" /><rect x="9" y="3" width="5.5" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.6" fill="none" /></> },
  { page: 'data', label: 'Data & SDK', section: 'Project', icon: <><circle cx="8" cy="8" r="2.4" stroke="currentColor" strokeWidth="1.6" fill="none" /><path d="M8 1.5v2m0 9v2M1.5 8h2m9 0h2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></> },
];

export function Sidebar({ route, loaded }: { route: Route; loaded: Loaded }) {
  return (
    <aside className="side">
      <div className="brand">
        <span className="brand-mark">
          <svg width="14" height="14" viewBox="0 0 14 14"><rect x="1" y="7" width="3" height="6" rx="1" fill="#fff" /><rect x="5.5" y="4" width="3" height="9" rx="1" fill="#fff" /><rect x="10" y="1" width="3" height="12" rx="1" fill="#fff" /></svg>
        </span>
        Shipstat
      </div>
      {items.map((it) => (
        <div key={it.page}>
          {it.section && <div className="nav-label">{it.section}</div>}
          <a className={route.page === it.page ? 'nav on' : 'nav'} href={`#${it.page}`}>
            <svg width="16" height="16" viewBox="0 0 16 16">{it.icon}</svg>
            {it.label}
          </a>
        </div>
      ))}
      <div className="side-foot">
        {loaded.count > 0 ? (
          <>
            <span className="dot" />
            {fmtInt(loaded.count)} events loaded
            <br />
            {loaded.source && <>Source: <span className="mono">{loaded.source}</span><br /></>}
            Analysed in your browser{loaded.at ? ` · ${fmtAgo(loaded.at)}` : ''}
          </>
        ) : (
          <>Nothing loaded. Data never leaves your browser.</>
        )}
      </div>
    </aside>
  );
}
