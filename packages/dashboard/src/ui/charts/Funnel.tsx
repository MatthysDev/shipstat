import type { FunnelStep } from '../../data/queries';
import { fmtInt, fmtPct } from '../../lib/format';
import { color } from '../../lib/palette';

/** Horizontal funnel; one bar per group when the funnel is split. */
export function Funnel({ steps, data }: { steps: string[]; data: FunnelStep[] }) {
  const groups = [...new Set(data.map((d) => d.group))];
  const value = (g: string, step: number) => data.find((d) => d.group === g && d.step === step)?.users ?? 0;
  const max = Math.max(1, ...groups.map((g) => value(g, 1)));
  return (
    <div className="funnel">
      {steps.map((name, i) => (
        <div key={name + i} className="funnel-step">
          <div className="funnel-label">
            <span className="mono">{i + 1}. {name}</span>
          </div>
          {groups.map((g, gi) => {
            const n = value(g, i + 1);
            const first = value(g, 1);
            const prev = i ? value(g, i) : first;
            return (
              <div key={g} className={groups.length > 1 ? 'funnel-row grouped' : 'funnel-row'}>
                {groups.length > 1 && <span className="funnel-group mono">{g}</span>}
                <div className="funnel-track">
                  <div className="funnel-bar" style={{ width: `${(n / max) * 100}%`, background: color(gi) }} />
                </div>
                <span className="funnel-num">
                  <b>{fmtInt(n)}</b>
                  {i > 0 && <span className="faint"> · {fmtPct(prev ? n / prev : 0, 0)} of previous · {fmtPct(first ? n / first : 0, 1)} overall</span>}
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
