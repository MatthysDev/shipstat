import { describe, expect, it } from 'vitest';
import type { Board } from './boards';
import { hash, mergeWorkspace, parseWorkspace } from './workspace';

const board = (id: string, name = id): Board => ({ id, name, widgets: [] });

describe('parseWorkspace', () => {
  it('reads a workspace and drops invalid parts', () => {
    const ws = parseWorkspace({ shipstat: 'workspace', version: 1, boards: [board('a'), { nope: 1 }], branding: { name: 'Acme', accent: 'blue' }, catalog: { events: { x: 'X' } } });
    expect(ws!.boards.map((b) => b.id)).toEqual(['a']);
    expect(ws!.branding).toEqual({ name: 'Acme' });
    expect(ws!.catalog.events.x).toEqual({ description: 'X' });
  });

  it('treats a bare tracking plan as a catalog-only workspace', () => {
    const ws = parseWorkspace({ events: [{ name: 'app_opened', description: 'Cold or warm start' }] });
    expect(ws!.catalog.events.app_opened.description).toBe('Cold or warm start');
    expect(ws!.boards).toEqual([]);
  });

  it('rejects unrelated JSON', () => {
    expect(parseWorkspace({ foo: 1 })).toBeNull();
    expect(parseWorkspace('x')).toBeNull();
  });
});

describe('mergeWorkspace', () => {
  it('replaces same-id boards in place and keeps local ones', () => {
    const local = { boards: [board('a', 'mine'), board('b')], catalog: { events: {}, keys: {} }, branding: { name: 'Old', accent: '#111111' } };
    const incoming = parseWorkspace({ shipstat: 'workspace', boards: [board('b', 'shared'), board('c')], branding: { name: 'New' } })!;
    const m = mergeWorkspace(local, incoming);
    expect(m.boards.map((b) => `${b.id}:${b.name}`)).toEqual(['a:mine', 'b:shared', 'c:c']);
    expect(m.branding).toEqual({ name: 'New', accent: '#111111' });
  });
});

describe('hash', () => {
  it('is stable and sensitive', () => {
    expect(hash('abc')).toBe(hash('abc'));
    expect(hash('abc')).not.toBe(hash('abd'));
  });
});
