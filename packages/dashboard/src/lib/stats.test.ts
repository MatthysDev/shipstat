import { describe, expect, it } from 'vitest';
import { compare, exposuresNeeded } from './stats';

describe('compare', () => {
  it('finds a clear winner', () => {
    const c = compare({ key: 'A', exposed: 5210, converted: 214 }, { key: 'B', exposed: 5180, converted: 275 });
    expect(c.rateControl).toBeCloseTo(0.0411, 3);
    expect(c.rateArm).toBeCloseTo(0.0531, 3);
    expect(c.probBetter).toBeGreaterThan(0.99);
    expect(c.uplift).toBeGreaterThan(0.15);
    expect(c.uplift).toBeLessThan(0.45);
    expect(c.upliftLow).toBeGreaterThan(0);
  });

  it('is unsure when arms are equal', () => {
    const c = compare({ key: 'A', exposed: 1000, converted: 50 }, { key: 'B', exposed: 1000, converted: 50 });
    expect(c.probBetter).toBeGreaterThan(0.4);
    expect(c.probBetter).toBeLessThan(0.6);
    expect(c.upliftLow).toBeLessThan(0);
    expect(c.upliftHigh).toBeGreaterThan(0);
  });

  it('is deterministic', () => {
    const a = compare({ key: 'A', exposed: 300, converted: 12 }, { key: 'B', exposed: 310, converted: 19 });
    const b = compare({ key: 'A', exposed: 300, converted: 12 }, { key: 'B', exposed: 310, converted: 19 });
    expect(a).toEqual(b);
  });

  it('handles empty arms without NaN', () => {
    const c = compare({ key: 'A', exposed: 0, converted: 0 }, { key: 'B', exposed: 0, converted: 0 }, 2000);
    expect(Number.isFinite(c.probBetter)).toBe(true);
    expect(c.rateArm).toBe(0);
  });
});

describe('exposuresNeeded', () => {
  it('asks for more data on a small difference', () => {
    const c = compare({ key: 'A', exposed: 1840, converted: 77 }, { key: 'B', exposed: 1812, converted: 82 });
    expect(exposuresNeeded(c)).toBeGreaterThan(1000);
  });
  it('returns null without a difference', () => {
    const c = compare({ key: 'A', exposed: 100, converted: 5 }, { key: 'B', exposed: 100, converted: 5 }, 1000);
    expect(exposuresNeeded(c)).toBeNull();
  });
});
