import { describe, expect, it } from 'vitest';
import { docLine, mergeCatalog, parseCatalog } from './catalog';

describe('parseCatalog', () => {
  it('reads the canonical shape', () => {
    const c = parseCatalog({ events: { paywall_viewed: { description: 'Paywall shown', props: { placement: 'Where' } } }, keys: { variant: 'A/B arm' } });
    expect(c).toEqual({ events: { paywall_viewed: { description: 'Paywall shown', props: { placement: 'Where' } } }, keys: { variant: 'A/B arm' } });
  });

  it('reads a list with common spellings', () => {
    const c = parseCatalog([{ name: 'purchase_done', description: ' Paid ', when: 'after the store confirms', team: 'Growth', tags: ['revenue'], properties: [{ name: 'plan', description: 'monthly or yearly' }] }]);
    expect(c!.events.purchase_done).toEqual({ description: 'Paid', trigger: 'after the store confirms', owner: 'Growth', category: 'revenue', props: { plan: 'monthly or yearly' } });
  });

  it('accepts a workspace and plain strings', () => {
    expect(parseCatalog({ catalog: { events: { a: 'Opened' } } })!.events.a).toEqual({ description: 'Opened' });
  });

  it('rejects what is not a plan', () => {
    expect(parseCatalog(42)).toBeNull();
    expect(parseCatalog({ hello: 1 })).toBeNull();
  });
});

describe('mergeCatalog', () => {
  it('lets the incoming plan win field by field and merges props', () => {
    const base = { events: { a: { description: 'old', owner: 'Core', props: { x: 'x', y: 'y' } } }, keys: {} };
    const over = { events: { a: { description: 'new', props: { y: 'Y' } }, b: { description: 'b' } }, keys: { variant: 'v' } };
    expect(mergeCatalog(base, over)).toEqual({
      events: { a: { description: 'new', owner: 'Core', props: { x: 'x', y: 'Y' } }, b: { description: 'b' } },
      keys: { variant: 'v' },
    });
  });
});

describe('docLine', () => {
  it('joins description and trigger', () => {
    expect(docLine({ description: 'Paywall shown', trigger: 'when the sheet opens' })).toBe('Paywall shown · Fires when the sheet opens');
    expect(docLine(undefined)).toBe('');
  });
});
