import { color } from '../../lib/palette';

export function Legend({ keys }: { keys: string[] }) {
  if (keys.length <= 1) return null;
  return (
    <div className="legend">
      {keys.map((k, i) => (
        <span key={k}>
          <i style={{ background: color(i) }} />
          {k}
        </span>
      ))}
    </div>
  );
}
