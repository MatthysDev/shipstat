/** User paths: from the sequences returned by SQL to a column flow ready to draw. */

export type Direction = 'after' | 'before';

export const OTHERS = 'Others';

/** One distinct path from the start event: `steps[0]` is the next (or previous) event. */
export interface PathRow {
  steps: (string | null)[];
  users: number;
}

export interface FlowNode {
  col: number;
  name: string;
  users: number;
  /** Users whose session ends here (no next step), only before the last column. */
  dropped: number;
}

export interface FlowLink {
  col: number;
  from: string;
  to: string;
  users: number;
}

export interface Flow {
  start: string;
  total: number;
  /** Column 0 is the start event; column i is i steps away. */
  columns: FlowNode[][];
  links: FlowLink[];
}

/**
 * Groups path rows into columns. Per column, the `top` most common events are kept and the
 * rest is grouped as "Others", so the chart stays readable whatever the number of events.
 */
export function buildFlow(start: string, rows: PathRow[], depth: number, top = 5): Flow {
  const total = rows.reduce((s, r) => s + r.users, 0);
  // Name shown at each column, after grouping.
  const shown: Map<string, string>[] = [new Map([[start, start]])];
  for (let c = 1; c <= depth; c++) {
    const counts = new Map<string, number>();
    for (const r of rows) {
      const n = r.steps[c - 1];
      if (n) counts.set(n, (counts.get(n) ?? 0) + r.users);
    }
    const ranked = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    // Grouping a single event as "Others" hides its name for nothing.
    const keep = ranked.length === top + 1 ? top + 1 : top;
    shown.push(new Map(ranked.map(([n], i) => [n, i < keep ? n : OTHERS])));
  }
  const at = (r: PathRow, c: number) => (c === 0 ? start : r.steps[c - 1] ? shown[c].get(r.steps[c - 1]!)! : null);

  const nodes = new Map<string, FlowNode>();
  const links = new Map<string, FlowLink>();
  for (const r of rows) {
    for (let c = 0; c <= depth; c++) {
      const name = at(r, c);
      if (!name) break;
      const k = `${c}|${name}`;
      const node = nodes.get(k) ?? { col: c, name, users: 0, dropped: 0 };
      node.users += r.users;
      nodes.set(k, node);
      const next = c < depth ? at(r, c + 1) : null;
      if (c < depth && !next) node.dropped += r.users;
      if (next) {
        const lk = `${c}|${name}|${next}`;
        const link = links.get(lk) ?? { col: c, from: name, to: next, users: 0 };
        link.users += r.users;
        links.set(lk, link);
      }
    }
  }
  const columns: FlowNode[][] = [];
  for (let c = 0; c <= depth; c++) {
    const col = [...nodes.values()].filter((n) => n.col === c).sort((a, b) => (a.name === OTHERS ? 1 : b.name === OTHERS ? -1 : b.users - a.users || a.name.localeCompare(b.name)));
    if (col.length) columns.push(col);
  }
  return { start, total, columns, links: [...links.values()] };
}

/** The most common complete paths, for the table under the chart. */
export function topPaths(rows: PathRow[], limit = 8): { steps: string[]; users: number }[] {
  const merged = new Map<string, { steps: string[]; users: number }>();
  for (const r of rows) {
    const steps = r.steps.filter((s): s is string => !!s);
    const k = steps.join('\u0000');
    const m = merged.get(k) ?? { steps, users: 0 };
    m.users += r.users;
    merged.set(k, m);
  }
  return [...merged.values()].sort((a, b) => b.users - a.users).slice(0, limit);
}

// --- Layout --------------------------------------------------------------------------------

export interface NodeBox extends FlowNode {
  x: number;
  y: number;
  h: number;
}

export interface LinkShape extends FlowLink {
  d: string;
}

export interface FlowLayout {
  width: number;
  height: number;
  nodes: NodeBox[];
  links: LinkShape[];
}

export const NODE_W = 10;
/** Vertical room kept per node so its two label lines never overlap the next one. */
const MIN_SLOT = 34;
const GAP = 12;

/**
 * Positions in real pixels. "before" mirrors the columns: the end event sits on the right.
 * Bands keep their thickness proportional to users at both ends.
 */
export function layoutFlow(flow: Flow, width: number, plotHeight: number, dir: Direction, labelW = 150): FlowLayout {
  const cols = flow.columns.length;
  const span = Math.max(1, cols - 1);
  const usable = Math.max(1, width - NODE_W - labelW);
  const xOf = (c: number) => ((dir === 'before' ? span - c : c) * usable) / span;
  const maxN = Math.max(1, ...flow.columns.map((c) => c.length));
  const k = flow.total ? Math.max(0, plotHeight - GAP * (maxN - 1)) / flow.total : 0;

  const boxes = new Map<string, NodeBox>();
  let height = 0;
  for (const col of flow.columns) {
    let y = 0;
    for (const n of col) {
      const h = Math.max(2, n.users * k);
      boxes.set(`${n.col}|${n.name}`, { ...n, x: xOf(n.col), y, h });
      y += Math.max(h, MIN_SLOT) + GAP;
    }
    height = Math.max(height, y - GAP);
  }

  // Stack bands on each node in the order of the nodes they reach, so they do not cross.
  const order = (col: number, name: string) => boxes.get(`${col}|${name}`)?.y ?? 0;
  const outOff = new Map<string, number>();
  const inOff = new Map<string, number>();
  const sorted = [...flow.links].sort((a, b) => a.col - b.col || order(a.col, a.from) - order(b.col, b.from) || order(a.col + 1, a.to) - order(b.col + 1, b.to));
  const links: LinkShape[] = [];
  for (const l of sorted) {
    const a = boxes.get(`${l.col}|${l.from}`)!;
    const b = boxes.get(`${l.col + 1}|${l.to}`)!;
    const t = l.users * k;
    const oa = outOff.get(`${l.col}|${l.from}`) ?? 0;
    const ob = inOff.get(`${l.col + 1}|${l.to}`) ?? 0;
    outOff.set(`${l.col}|${l.from}`, oa + t);
    inOff.set(`${l.col + 1}|${l.to}`, ob + t);
    const xa = a.x < b.x ? a.x + NODE_W : a.x;
    const xb = a.x < b.x ? b.x : b.x + NODE_W;
    const ya = a.y + oa;
    const yb = b.y + ob;
    const xm = (xa + xb) / 2;
    const f = (v: number) => v.toFixed(1);
    links.push({
      ...l,
      d: `M${f(xa)} ${f(ya)}C${f(xm)} ${f(ya)} ${f(xm)} ${f(yb)} ${f(xb)} ${f(yb)}L${f(xb)} ${f(yb + t)}C${f(xm)} ${f(yb + t)} ${f(xm)} ${f(ya + t)} ${f(xa)} ${f(ya + t)}Z`,
    });
  }
  return { width, height: Math.max(height, 40), nodes: [...boxes.values()], links };
}
