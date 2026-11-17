import { describe, expect, it } from 'vitest';
import { accentTokens, brandCss, cleanBranding, contrast, MIN_CONTRAST } from './branding';

describe('accentTokens', () => {
  it('keeps a readable accent in both themes', () => {
    for (const hex of ['#f2542d', '#ffe600', '#0a0a0a', '#3b82f6', '#22c55e']) {
      expect(contrast(accentTokens(hex, 'light').accent, '#ffffff')).toBeGreaterThanOrEqual(MIN_CONTRAST);
      expect(contrast(accentTokens(hex, 'dark').accent, '#171812')).toBeGreaterThanOrEqual(MIN_CONTRAST);
    }
  });

  it('leaves a color that already reads alone', () => {
    expect(accentTokens('#c2361b', 'light').accent).toBe('#c2361b');
  });

  it('picks the text color that reads on the accent', () => {
    expect(accentTokens('#1d4ed8', 'light').onAccent).toBe('#ffffff');
    expect(accentTokens('#facc15', 'dark').onAccent).toBe('#14150f');
  });
});

describe('cleanBranding', () => {
  it('drops anything that could inject CSS or script', () => {
    expect(cleanBranding({ accent: 'red;}body{display:none', logo: 'javascript:alert(1)', name: '  Acme  ' })).toEqual({ name: 'Acme' });
    expect(cleanBranding({ logo: 'data:image/png;base64,AAAA', accent: '#AABBCC' })).toEqual({ logo: 'data:image/png;base64,AAAA', accent: '#aabbcc' });
  });

  it('emits no CSS for the default accent', () => {
    expect(brandCss({ accent: '#f2542d' })).toBe('');
    expect(brandCss({ accent: '#3b82f6' })).toContain('prefers-color-scheme: dark');
  });
});
