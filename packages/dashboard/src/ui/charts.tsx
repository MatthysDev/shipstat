import { fmtCompact, fmtDay } from '../lib/format';

export const PALETTE = ['#4f46e5', '#0e9f6e', '#e8833a', '#b3b3bb', '#d946ef', '#0891b2'];

export interface Point {
  day: Date;
  key: string;
  n: number;
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

function daysOf(points: Point[]): number[] {
  return [...new Set(points.map((p) => p.day.getTime()))].sort((a, b) => a - b);
}

const W = 1000;
const X0 = 48;

function Axis({ max, top, h, fmt }: { max: number; top: number; h: number; fmt: (n: number) => string }) {
  return (
    <>
      {[0, 1, 2, 3].map((i) => {
        const v = (max / 3) * i;
        const y = top + h - (v / max) * h;
        return (
          <g key={i}>
            <line x1={X0} x2={W} y1={y} y2={y} stroke="#f0efec" />
            <text className="axis" x={0} y={y + 4}>{fmt(v)}</text>
          </g>
        );
      })}
    </>
  );
}

function XLabels({ days, x, y }: { days: number[]; x: (i: number) => number; y: number }) {
  if (!days.length) return null;
  const idx = days.length <= 6 ? days.map((_, i) => i) : [0, 1, 2, 3, 4].map((k) => Math.round((k * (days.length - 1)) / 4));
  return (
    <>
      {[...new Set(idx)].map((i) => (
        <text key={i} className="axis" x={x(i)} y={y} textAnchor="middle">{fmtDay(new Date(days[i]))}</text>
      ))}
    </>
  );
}

export function StackedBars({ keys, points, height = 250 }: { keys: string[]; points: Point[]; height?: number }) {
  const days = daysOf(points);
  const top = 8, h = height - 36;
  const totals = days.map((d) => points.filter((p) => p.day.getTime() === d).reduce((s, p) => s + p.n, 0));
  const max = niceMax(Math.max(1, ...totals));
  const bw = (W - X0) / Math.max(1, days.length);
  return (
    <svg viewBox={`0 0 ${W} ${height}`} role="img">
      <Axis max={max} top={top} h={h} fmt={fmtCompact} />
      {days.map((d, i) => {
        let y = top + h;
        return keys.map((k, ki) => {
          const n = points.find((p) => p.day.getTime() === d && p.key === k)?.n ?? 0;
          const bh = (n / max) * h;
          y -= bh;
          return bh > 0.3 ? (
            <rect key={d + k} x={X0 + i * bw + Math.min(2, bw * 0.1)} y={y} width={Math.max(1, bw - Math.min(4, bw * 0.2))} height={bh} fill={PALETTE[ki % PALETTE.length]} rx={1.5}>
              <title>{`${fmtDay(new Date(d))} · ${k}: ${n}`}</title>
            </rect>
          ) : null;
        });
      })}
      <XLabels days={days} x={(i) => X0 + i * bw + bw / 2} y={height - 2} />
    </svg>
  );
}

export function Lines({ keys, points, height = 240, fmt = fmtCompact, maxValue }: { keys: string[]; points: Point[]; height?: number; fmt?: (n: number) => string; maxValue?: number }) {
  const days = daysOf(points);
  const top = 8, h = height - 36;
  const max = maxValue ?? niceMax(Math.max(1e-9, ...points.map((p) => p.n)));
  const step = (W - X0) / Math.max(1, days.length - 1);
  const x = (i: number) => (days.length === 1 ? X0 + (W - X0) / 2 : X0 + i * step);
  return (
    <svg viewBox={`0 0 ${W} ${height}`} role="img">
      <Axis max={max} top={top} h={h} fmt={fmt} />
      {keys.map((k, ki) => {
        const d = days
          .map((day, i) => {
            const n = points.find((p) => p.day.getTime() === day && p.key === k)?.n ?? 0;
            return `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${(top + h - (n / max) * h).toFixed(1)}`;
          })
          .join(' ');
        return <path key={k} d={d} fill="none" stroke={PALETTE[ki % PALETTE.length]} strokeWidth={2.4} strokeLinejoin="round" strokeLinecap="round" />;
      })}
      <XLabels days={days} x={x} y={height - 2} />
    </svg>
  );
}

export function Legend({ keys }: { keys: string[] }) {
  return (
    <div className="legend">
      {keys.map((k, i) => (
        <span key={k}>
          <i style={{ background: PALETTE[i % PALETTE.length] }} />
          {k}
        </span>
      ))}
    </div>
  );
}
