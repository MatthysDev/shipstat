import { useWidth } from './useWidth';

export function Sparkline({ values, height = 36, stroke = 'var(--accent)' }: { values: number[]; height?: number; stroke?: string }) {
  const { ref, width } = useWidth(200);
  if (values.length < 2) return <div ref={ref} style={{ height }} />;
  const max = Math.max(1e-9, ...values);
  const step = width / (values.length - 1);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(1)} ${(height - 2 - (v / max) * (height - 4)).toFixed(1)}`).join(' ');
  return (
    <div ref={ref}>
      <svg width={width} height={height} role="img">
        <path d={`${d} L${width} ${height} L0 ${height} Z`} fill={stroke} opacity={0.08} />
        <path d={d} fill="none" stroke={stroke} strokeWidth={1.8} />
      </svg>
    </div>
  );
}
