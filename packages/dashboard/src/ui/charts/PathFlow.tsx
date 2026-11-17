import { docLine, useCatalog } from '../../lib/catalog';
import { fmtInt, fmtPct } from '../../lib/format';
import { layoutFlow, NODE_W, OTHERS, type Direction, type Flow } from '../../lib/paths';
import { useWidth } from './useWidth';

const short = (s: string, n = 24) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/** Sankey-like column flow. Bands are users; what does not continue is the session drop-off. */
export function PathFlow({ flow, direction, height = 260, onPick }: { flow: Flow; direction: Direction; height?: number; onPick?: (name: string) => void }) {
  const { ref, width } = useWidth();
  const cat = useCatalog();
  if (!flow.total) return <div ref={ref} className="chart paths"><p className="muted">No user did this event in the period.</p></div>;
  const lay = layoutFlow(flow, width, height, direction, Math.min(170, width / (flow.columns.length + 1)));
  const pct = (n: number) => fmtPct(n / flow.total, 0);
  return (
    <div ref={ref} className="chart paths">
      <svg width={width} height={lay.height + 4} role="img" aria-label={`Paths ${direction === 'before' ? 'ending at' : 'starting at'} ${flow.start}`}>
        <g className="path-links">
          {lay.links.map((l) => (
            <path key={`${l.col}|${l.from}|${l.to}`} d={l.d}>
              <title>{`${direction === 'before' ? `${l.to} → ${l.from}` : `${l.from} → ${l.to}`}: ${fmtInt(l.users)} users (${pct(l.users)})`}</title>
            </path>
          ))}
        </g>
        {lay.nodes.map((n) => {
          const start = n.col === 0;
          const clickable = onPick && !start && n.name !== OTHERS;
          const desc = docLine(cat.events[n.name]);
          const lines = [`${fmtInt(n.users)} · ${pct(n.users)}`, n.dropped && n.col < flow.columns.length - 1 ? `${fmtPct(n.dropped / n.users, 0)} stop` : ''].filter(Boolean).join(' · ');
          return (
            <g key={`${n.col}|${n.name}`} className={clickable ? 'path-node link' : 'path-node'} onClick={clickable ? () => onPick(n.name) : undefined}>
              <rect x={n.x} y={n.y} width={NODE_W} height={n.h} rx={3} fill={start ? 'var(--accent)' : n.name === OTHERS ? 'var(--s3)' : 'var(--text)'} />
              <text x={n.x + NODE_W + 7} y={n.y + 11} className="path-label">
                <tspan className={n.name === OTHERS ? 'path-name others' : 'path-name'}>{short(n.name)}</tspan>
                <tspan x={n.x + NODE_W + 7} dy={14} className="path-num">{lines}</tspan>
              </text>
              <title>{[`${n.name}: ${fmtInt(n.users)} users`, n.dropped ? `${fmtInt(n.dropped)} end their session here` : '', desc].filter(Boolean).join('\n')}</title>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
