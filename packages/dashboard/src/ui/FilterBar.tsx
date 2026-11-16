import { distinctValues, type Filters, type Range } from '../data/queries';
import { useAsync } from './hooks';

const DIMS = [
  { key: 'app_version', label: 'Version' },
  { key: 'platform', label: 'Platform' },
  { key: 'variant', label: 'Variant' },
  { key: 'feature', label: 'Feature' },
] as const;

export function RangePicker({ range, setRange }: { range: Range; setRange: (r: Range) => void }) {
  return (
    <div className="seg">
      {(['24h', '7d', '30d', '90d'] as Range[]).map((r) => (
        <button key={r} type="button" className={r === range ? 'on' : ''} onClick={() => setRange(r)}>
          {r}
        </button>
      ))}
    </div>
  );
}

export function FilterBar({ filters, setFilters, version }: { filters: Filters; setFilters: (f: Filters) => void; version: number }) {
  const values = useAsync(async () => {
    const out: Record<string, string[]> = {};
    for (const d of DIMS) out[d.key] = await distinctValues(d.key);
    return out;
  }, [version]);
  return (
    <div className="filters">
      {DIMS.map((d) => (
        <select
          key={d.key}
          className={filters[d.key] ? 'chip on' : 'chip'}
          value={filters[d.key] ?? ''}
          onChange={(e) => setFilters({ ...filters, [d.key]: e.target.value || undefined })}
          aria-label={d.label}
        >
          <option value="">{d.label}: all</option>
          {(values.data?.[d.key] ?? []).map((v) => (
            <option key={v} value={v}>
              {d.label}: {v}
            </option>
          ))}
        </select>
      ))}
      {Object.values(filters).some(Boolean) && (
        <button type="button" className="chip ghost" onClick={() => setFilters({})}>
          Clear filters
        </button>
      )}
    </div>
  );
}
