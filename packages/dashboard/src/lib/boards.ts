import type { Filters, Metric, Range } from '../data/sql';
import { isArray, readJson, writeJson } from './storage';

export type Viz = 'line' | 'bar' | 'number' | 'pie' | 'table' | 'funnel' | 'feed';

export const VIZ_LABELS: Record<Viz, string> = {
  line: 'Line',
  bar: 'Bars',
  number: 'Number',
  pie: 'Donut',
  table: 'Table',
  funnel: 'Funnel',
  feed: 'Live feed',
};

export const METRIC_LABELS: Record<Metric, string> = {
  events: 'Events',
  users: 'Unique users',
  per_user: 'Events per user',
};

/** One chart on a board. Everything a person can configure lives here. */
export interface Widget {
  id: string;
  title: string;
  viz: Viz;
  /** Empty = all events. */
  event?: string;
  /** Funnel steps, in order. */
  steps?: string[];
  metric: Metric;
  /** Split by this key (context or prop). Empty = no split. */
  split?: string;
  range: Range;
  filters: Filters;
  /** Width in columns, out of 3. */
  size: 1 | 2 | 3;
}

export interface Board {
  id: string;
  name: string;
  widgets: Widget[];
}

const KEY = 'shipstat.boards.v1';

function isWidget(v: unknown): v is Widget {
  const w = v as Widget;
  return !!w && typeof w.id === 'string' && typeof w.viz === 'string' && typeof w.metric === 'string' && typeof w.range === 'string';
}

export function isBoard(v: unknown): v is Board {
  const b = v as Board;
  return !!b && typeof b.id === 'string' && typeof b.name === 'string' && isArray(b.widgets) && b.widgets.every(isWidget);
}

const isBoards = (v: unknown): v is Board[] => isArray(v) && v.every(isBoard);

export const loadBoards = () => readJson<Board[]>(KEY, [], isBoards);
export const saveBoards = (b: Board[]) => writeJson(KEY, b);

/** Random id. crypto.randomUUID only exists on HTTPS, and self-hosted copies may run on plain HTTP. */
export const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function blankWidget(): Widget {
  return { id: newId(), title: 'New chart', viz: 'line', metric: 'events', range: '30d', filters: {}, size: 1 };
}

/** A first board built from the events that actually exist, so it is useful right away. */
export function starterBoard(events: string[]): Board {
  const has = (e: string) => events.includes(e);
  const funnelSteps = ['app_opened', 'paywall_viewed', 'purchase_done'].filter(has);
  const steps = funnelSteps.length >= 2 ? funnelSteps : events.slice(0, 3);
  const goal = has('purchase_done') ? 'purchase_done' : events[events.length - 1];
  const w = (x: Partial<Widget> & Pick<Widget, 'title' | 'viz'>): Widget => ({ ...blankWidget(), ...x, id: newId() });
  return {
    id: newId(),
    name: 'Starter',
    widgets: [
      w({ title: 'Unique users', viz: 'number', metric: 'users' }),
      w({ title: 'Events', viz: 'number', metric: 'events' }),
      w({ title: goal ? `${goal}, users` : 'Events per user', viz: 'number', metric: goal ? 'users' : 'per_user', event: goal }),
      w({ title: 'Events per day by app version', viz: 'bar', split: 'app_version', size: 2 }),
      w({ title: 'Platforms', viz: 'pie', split: 'platform', metric: 'users' }),
      w({ title: 'Conversion funnel', viz: 'funnel', steps, metric: 'users', size: 2 }),
      w({ title: 'Top events', viz: 'table', split: 'name' }),
      w({ title: 'Active users per day by variant', viz: 'line', split: 'variant', metric: 'users', size: 2 }),
      w({ title: 'Locales', viz: 'pie', split: 'locale', metric: 'users' }),
      w({ title: 'Latest events', viz: 'feed', size: 3 }),
    ],
  };
}
