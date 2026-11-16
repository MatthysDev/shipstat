import { fmtDay } from '../../lib/format';
import { labelIndexes } from './scale';

export const PAD_LEFT = 48;
export const PAD_TOP = 8;
export const PAD_BOTTOM = 26;

export function YAxis({ max, width, plotHeight, fmt }: { max: number; width: number; plotHeight: number; fmt: (n: number) => string }) {
  return (
    <>
      {[0, 1, 2, 3].map((i) => {
        const v = (max / 3) * i;
        const y = PAD_TOP + plotHeight - (v / max) * plotHeight;
        return (
          <g key={i}>
            <line x1={PAD_LEFT} x2={width} y1={y} y2={y} stroke="var(--line-soft)" />
            <text className="axis" x={0} y={y + 4}>{fmt(v)}</text>
          </g>
        );
      })}
    </>
  );
}

export function XAxis({ times, x, y, hourly }: { times: number[]; x: (i: number) => number; y: number; hourly?: boolean }) {
  return (
    <>
      {labelIndexes(times.length).map((i) => (
        <text key={i} className="axis" x={x(i)} y={y} textAnchor="middle">
          {hourly ? new Date(times[i]).toLocaleTimeString('en-US', { hour: 'numeric', timeZone: 'UTC' }) : fmtDay(new Date(times[i]))}
        </text>
      ))}
    </>
  );
}
