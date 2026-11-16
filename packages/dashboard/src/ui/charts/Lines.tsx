import type { Series } from '../../data/queries';
import { fmtCompact } from '../../lib/format';
import { color } from '../../lib/palette';
import { PAD_BOTTOM, PAD_LEFT, PAD_TOP, XAxis, YAxis } from './Axes';
import { buckets, grid, niceMax } from './scale';
import { useWidth } from './useWidth';

interface Props {
  data: Series;
  height?: number;
  fmt?: (n: number) => string;
  max?: number;
  hourly?: boolean;
}

export function Lines({ data, height = 240, fmt = fmtCompact, max, hourly }: Props) {
  const { ref, width } = useWidth();
  const times = buckets(data.points);
  const at = grid(data.points);
  const plotH = height - PAD_TOP - PAD_BOTTOM;
  const top = max ?? niceMax(Math.max(1e-9, ...data.points.map((p) => p.n)));
  const step = (width - PAD_LEFT) / Math.max(1, times.length - 1);
  const x = (i: number) => (times.length === 1 ? PAD_LEFT + (width - PAD_LEFT) / 2 : PAD_LEFT + i * step);
  const y = (n: number) => PAD_TOP + plotH - (n / top) * plotH;
  return (
    <div ref={ref} className="chart">
      <svg width={width} height={height} role="img">
        <YAxis max={top} width={width} plotHeight={plotH} fmt={fmt} />
        {data.keys.map((k, ki) => (
          <path
            key={k}
            d={times.map((t, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(at(t, k)).toFixed(1)}`).join(' ')}
            fill="none"
            stroke={color(ki)}
            strokeWidth={2.2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        <XAxis times={times} x={x} y={height - 4} hourly={hourly} />
      </svg>
    </div>
  );
}
