import type { Series } from '../../data/queries';
import { fmtCompact, fmtDay } from '../../lib/format';
import { color } from '../../lib/palette';
import { PAD_BOTTOM, PAD_LEFT, PAD_TOP, XAxis, YAxis } from './Axes';
import { buckets, grid, niceMax } from './scale';
import { useWidth } from './useWidth';

/** Stacked bars per time bucket; a single series gives plain bars. */
export function Bars({ data, height = 240, hourly }: { data: Series; height?: number; hourly?: boolean }) {
  const { ref, width } = useWidth();
  const times = buckets(data.points);
  const at = grid(data.points);
  const plotH = height - PAD_TOP - PAD_BOTTOM;
  const totals = times.map((t) => data.keys.reduce((s, k) => s + at(t, k), 0));
  const top = niceMax(Math.max(1, ...totals));
  const bw = (width - PAD_LEFT) / Math.max(1, times.length);
  const gap = Math.min(3, bw * 0.2);
  return (
    <div ref={ref} className="chart">
      <svg width={width} height={height} role="img">
        <YAxis max={top} width={width} plotHeight={plotH} fmt={fmtCompact} />
        {times.map((t, i) => {
          let y = PAD_TOP + plotH;
          return data.keys.map((k, ki) => {
            const n = at(t, k);
            const h = (n / top) * plotH;
            y -= h;
            if (h < 0.3) return null;
            return (
              <rect key={`${t}${k}`} x={PAD_LEFT + i * bw + gap / 2} y={y} width={Math.max(1, bw - gap)} height={h} fill={color(ki)} rx={1.5}>
                <title>{`${fmtDay(new Date(t))} · ${k}: ${fmtCompact(n)}`}</title>
              </rect>
            );
          });
        })}
        <XAxis times={times} x={(i) => PAD_LEFT + i * bw + bw / 2} y={height - 4} hourly={hourly} />
      </svg>
    </div>
  );
}
