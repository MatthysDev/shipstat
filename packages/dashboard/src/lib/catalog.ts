import { createStore, isArray, isObject, useStore } from './storage';

/** What an event means, written by the team. Every field is optional. */
export interface EventDoc {
  /** What it means. */
  description?: string;
  /** When it fires. */
  trigger?: string;
  owner?: string;
  category?: string;
  /** Description per prop. */
  props?: Record<string, string>;
}

/** The tracking plan: events by name, plus context keys (app_version, variant…). */
export interface Catalog {
  events: Record<string, EventDoc>;
  keys: Record<string, string>;
}

export const EMPTY_CATALOG: Catalog = { events: {}, keys: {} };

const FIELDS = ['description', 'trigger', 'owner', 'category'] as const;

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** `{ k: 'text' }`, `{ k: { description } }` or `[{ name, description }]` → `{ k: 'text' }`. */
function textMap(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (isArray(v)) {
    for (const x of v) if (isObject(x) && str(x.name) && str(x.description)) out[str(x.name)!] = str(x.description)!;
  } else if (isObject(v)) {
    for (const [k, x] of Object.entries(v)) {
      const text = str(x) ?? (isObject(x) ? str(x.description) : undefined);
      if (text) out[k] = text;
    }
  }
  return out;
}

function parseDoc(v: unknown): EventDoc {
  if (typeof v === 'string') return str(v) ? { description: str(v) } : {};
  if (!isObject(v)) return {};
  const doc: EventDoc = {
    description: str(v.description),
    // Common spellings in tracking plans.
    trigger: str(v.trigger) ?? str(v.when) ?? str(v.fires),
    owner: str(v.owner) ?? str(v.team),
    category: str(v.category) ?? str(v.tag) ?? (isArray(v.tags) ? str(v.tags[0]) : undefined),
  };
  const props = textMap(v.props ?? v.properties);
  if (Object.keys(props).length) doc.props = props;
  return clean(doc);
}

/** Drops empty fields, so a stored doc only holds what was written. */
export function clean(doc: EventDoc): EventDoc {
  const out: EventDoc = {};
  for (const f of FIELDS) if (str(doc[f])) out[f] = doc[f]!.trim();
  const props = Object.fromEntries(Object.entries(doc.props ?? {}).filter(([, t]) => str(t)).map(([k, t]) => [k, t.trim()]));
  if (Object.keys(props).length) out.props = props;
  return out;
}

/**
 * Reads a tracking plan in the shapes people write them:
 * `{ events: { name: doc } }`, `{ events: [{ name, ... }] }`, `[{ name, ... }]`, or a
 * workspace `{ catalog }`. Context key descriptions go in `keys` (or `context`).
 */
export function parseCatalog(v: unknown): Catalog | null {
  if (isObject(v) && 'catalog' in v) return parseCatalog(v.catalog);
  const list = isArray(v) ? v : isObject(v) ? v.events : undefined;
  const events: Record<string, EventDoc> = {};
  if (isArray(list)) {
    for (const x of list) if (isObject(x) && str(x.name)) events[str(x.name)!] = parseDoc(x);
  } else if (isObject(list)) {
    for (const [name, x] of Object.entries(list)) events[name] = parseDoc(x);
  } else if (!(isObject(v) && (v.keys || v.context))) {
    return null;
  }
  const keys = isObject(v) ? textMap(v.keys ?? v.context) : {};
  return { events, keys };
}

/** `over` wins field by field; props are merged. */
export function mergeCatalog(base: Catalog, over: Catalog): Catalog {
  const events = { ...base.events };
  for (const [name, doc] of Object.entries(over.events)) {
    const prev = events[name] ?? {};
    events[name] = clean({ ...prev, ...doc, props: { ...prev.props, ...doc.props } });
  }
  return { events, keys: { ...base.keys, ...over.keys } };
}

export const isDocumented = (doc?: EventDoc) => !!doc?.description;

/** One line for tooltips and subtitles. */
export function docLine(doc?: EventDoc): string {
  if (!doc) return '';
  return [doc.description, doc.trigger && `Fires ${doc.trigger.replace(/^fires\s+/i, '')}`].filter(Boolean).join(' · ');
}

const isCatalog = (v: unknown): v is Catalog => isObject(v) && isObject(v.events) && isObject(v.keys);

export const catalogStore = createStore<Catalog>('shipstat.catalog.v1', EMPTY_CATALOG, isCatalog);

export const useCatalog = () => useStore(catalogStore);

export function setEventDoc(name: string, doc: EventDoc) {
  const cur = catalogStore.get();
  const events = { ...cur.events, [name]: clean(doc) };
  if (!Object.keys(events[name]).length) delete events[name];
  catalogStore.set({ ...cur, events });
}

export function setKeyDoc(key: string, text: string) {
  const cur = catalogStore.get();
  const keys = { ...cur.keys, [key]: text.trim() };
  if (!keys[key]) delete keys[key];
  catalogStore.set({ ...cur, keys });
}
