import { distinctValues } from '../data/queries';
import { FILTER_KEYS, RANGES, type Filters, type Range } from '../data/sql';
import { useAsync } from './hooks';

const LABELS = { app_version: 'Version', platform: 'Platform', variant: 'Variant', feature: 'Feature' } as const;

export function RangePicker({ range, setRange }: { range: Range; setRange: (r: Range) => void }) {
  return (
    <div className="seg" role="group" aria-label="Period">
      {RANGES.map((r) => (
        <button key={r} type="button" className={r === range ? 'on' : ''} onClick={() => setRange(r)}>{r}</button>
      ))}
    </div>
  );
}

export function FilterBar({ filters, setFilters, version }: { filters: Filters; setFilters: (f: Filters) => void; version: number }) {
  const values = useAsync(async () => Object.fromEntries(await Promise.all(FILTER_KEYS.map(async (k) => [k, await distinctValues(k)] as const))), [version]);
  return (
    <div className="filters">
      {FILTER_KEYS.map((k) => (
        <select key={k} className={filters[k] ? 'chip on' : 'chip'} value={filters[k] ?? ''} onChange={(e) => setFilters({ ...filters, [k]: e.target.value || undefined })} aria-label={LABELS[k]}>
          <option value="">{LABELS[k]}: all</option>
          {(values.data?.[k] ?? []).map((v) => <option key={v} value={v}>{LABELS[k]}: {v}</option>)}
        </select>
      ))}
      {Object.values(filters).some(Boolean) && <button type="button" className="chip ghost" onClick={() => setFilters({})}>Clear filters</button>}
    </div>
  );
}
