import { describe, expect, it } from 'vitest';
import { buildFlow, layoutFlow, OTHERS, topPaths, type PathRow } from './paths';

const rows: PathRow[] = [
  { steps: ['paywall_viewed', 'purchase_done'], users: 40 },
  { steps: ['paywall_viewed', null], users: 30 },
  { steps: ['workout_started', 'set_logged'], users: 20 },
  { steps: ['share_tapped', null], users: 6 },
  { steps: ['settings_opened', null], users: 3 },
  { steps: [null, null], users: 1 },
];

describe('buildFlow', () => {
  it('counts users per column and keeps the start total', () => {
    const f = buildFlow('app_opened', rows, 2, 5);
    expect(f.total).toBe(100);
    expect(f.columns[0]).toEqual([{ col: 0, name: 'app_opened', users: 100, dropped: 1 }]);
    expect(f.columns[1].map((n) => [n.name, n.users])).toEqual([
      ['paywall_viewed', 70],
      ['workout_started', 20],
      ['share_tapped', 6],
      ['settings_opened', 3],
    ]);
  });

  it('tracks drop-off where sessions end', () => {
    const f = buildFlow('app_opened', rows, 2, 5);
    const paywall = f.columns[1].find((n) => n.name === 'paywall_viewed')!;
    expect(paywall.dropped).toBe(30);
    // The last column never reports a drop: the path is cut, not the session.
    expect(f.columns[2].every((n) => n.dropped === 0)).toBe(true);
  });

  it('groups events past the top K as Others, last', () => {
    const f = buildFlow('app_opened', rows, 2, 2);
    expect(f.columns[1].map((n) => n.name)).toEqual(['paywall_viewed', 'workout_started', OTHERS]);
    expect(f.columns[1].at(-1)!.users).toBe(9);
    expect(f.links.find((l) => l.col === 0 && l.to === OTHERS)!.users).toBe(9);
  });

  it('does not hide a single event behind Others', () => {
    const f = buildFlow('app_opened', rows, 1, 3);
    expect(f.columns[1].map((n) => n.name)).not.toContain(OTHERS);
  });

  it('links add up to what continues', () => {
    const f = buildFlow('app_opened', rows, 2, 5);
    for (const col of f.columns.slice(0, -1)) {
      for (const n of col) {
        const out = f.links.filter((l) => l.col === n.col && l.from === n.name).reduce((s, l) => s + l.users, 0);
        expect(out + n.dropped).toBe(n.users);
      }
    }
  });
});

describe('topPaths', () => {
  it('merges paths that only differ by their end', () => {
    const t = topPaths(rows);
    expect(t[0]).toEqual({ steps: ['paywall_viewed', 'purchase_done'], users: 40 });
    expect(t.find((p) => p.steps.length === 0)!.users).toBe(1);
  });
});

describe('layoutFlow', () => {
  it('mirrors columns for paths ending at an event', () => {
    const f = buildFlow('purchase_done', rows, 2, 5);
    const after = layoutFlow(f, 800, 300, 'after');
    const before = layoutFlow(f, 800, 300, 'before');
    const x = (l: typeof after, col: number) => l.nodes.find((n) => n.col === col)!.x;
    expect(x(after, 0)).toBeLessThan(x(after, 2));
    expect(x(before, 0)).toBeGreaterThan(x(before, 2));
    expect(after.links.every((l) => !l.d.includes('NaN'))).toBe(true);
  });
});
