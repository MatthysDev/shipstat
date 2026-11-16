import { fmtCompact, fmtPct } from '../../lib/format';
import { color } from '../../lib/palette';

export interface Slice {
  label: string;
  value: number;
}

/** Donut with a legend. Slices past the 5th are grouped as "other". */
export function Donut({ slices, size = 160 }: { slices: Slice[]; size?: number }) {
  const sorted = [...slices].sort((a, b) => b.value - a.value);
  const shown = sorted.slice(0, 5);
  const rest = sorted.slice(5).reduce((s, x) => s + x.value, 0);
  if (rest > 0) shown.push({ label: 'other', value: rest });
  const total = shown.reduce((s, x) => s + x.value, 0) || 1;
  const r = size / 2 - 12;
  const c = 2 * Math.PI * r;
  const lengths = shown.map((s) => (s.value / total) * c);
  const offsets = lengths.map((_, i) => lengths.slice(0, i).reduce((a, b) => a + b, 0));
  return (
    <div className="donut">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img">
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          {shown.map((s, i) => (
            <circle key={s.label} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color(i)} strokeWidth={20} strokeDasharray={`${lengths[i]} ${c - lengths[i]}`} strokeDashoffset={-offsets[i]} />
          ))}
        </g>
        <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" className="donut-total">{fmtCompact(total)}</text>
      </svg>
      <ul className="donut-legend">
        {shown.map((s, i) => (
          <li key={s.label}>
            <i style={{ background: color(i) }} />
            <span className="mono">{s.label}</span>
            <b>{fmtPct(s.value / total, 0)}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}
