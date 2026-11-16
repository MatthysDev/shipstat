import { fmtAgo, fmtInt } from '../lib/format';
import type { Route } from '../lib/router';
import type { Loaded } from './App';
import { Logo } from './Logo';

const NAV: { page: Route['page']; label: string; section?: string }[] = [
  { page: 'boards', label: 'Boards', section: 'Stats' },
  { page: 'overview', label: 'Overview' },
  { page: 'event', label: 'Events' },
  { page: 'experiments', label: 'A/B tests' },
  { page: 'data', label: 'Data & SDK', section: 'Project' },
];

export function Sidebar({ route, loaded }: { route: Route; loaded: Loaded }) {
  return (
    <aside className="side">
      <a className="brand" href="#boards">
        <Logo />
        shipstat
      </a>
      {NAV.map((it) => (
        <div key={it.page}>
          {it.section && <div className="nav-label">{it.section}</div>}
          <a className={route.page === it.page ? 'nav on' : 'nav'} href={`#${it.page}`}>
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
