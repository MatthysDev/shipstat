import { createStore, isObject, useStore } from './storage';

/** How the dashboard looks for a team. */
export interface Branding {
  /** Shown in the sidebar and the tab title instead of "shipstat". */
  name?: string;
  /** `#rrggbb`. Drives the accent, buttons and the highlighted chart series. */
  accent?: string;
  /** Image URL or `data:image/…` URL. */
  logo?: string;
  /** Board opened on `#boards`. */
  defaultBoard?: string;
}

export const DEFAULT_ACCENT = '#f2542d';
/** Surfaces the accent is drawn on, per theme (see styles.css). */
const SURFACE = { light: '#ffffff', dark: '#171812' };
const BG = { light: '#fbfaf6', dark: '#0f100c' };
const INK = '#14150f';
/** WCAG minimum for graphics and large text. */
export const MIN_CONTRAST = 3;

export const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

/** Only images: http(s), same-site paths or `data:image/`. */
export const isLogo = (v: unknown): v is string =>
  typeof v === 'string' && v.length < 400_000 && (/^https?:\/\//i.test(v) || /^data:image\/[a-z+.-]+;base64,/i.test(v) || /^\.{0,2}\/[^/]/.test(v));

export function cleanBranding(v: unknown): Branding {
  if (!isObject(v)) return {};
  const b: Branding = {};
  if (typeof v.name === 'string' && v.name.trim()) b.name = v.name.trim().slice(0, 60);
  if (isHex(v.accent)) b.accent = v.accent.toLowerCase();
  if (isLogo(v.logo)) b.logo = v.logo;
  if (typeof v.defaultBoard === 'string' && v.defaultBoard) b.defaultBoard = v.defaultBoard;
  return b;
}

// --- Color -------------------------------------------------------------------------------

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (c: number[]) => '#' + c.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('');

/** `t` of `b` into `a`. */
export function mix(a: string, b: string, t: number): string {
  const x = rgb(a);
  const y = rgb(b);
  return toHex(x.map((v, i) => v + (y[i] - v) * t));
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Darkens (light theme) or lightens (dark theme) a color until it reads on the surface. */
export function readable(hex: string, theme: 'light' | 'dark'): string {
  const toward = theme === 'light' ? '#000000' : '#ffffff';
  let c = hex;
  for (let t = 0.05; contrast(c, SURFACE[theme]) < MIN_CONTRAST && t <= 1; t += 0.05) c = mix(hex, toward, t);
  return c;
}

export interface AccentTokens {
  accent: string;
  deep: string;
  soft: string;
  onAccent: string;
  /** Contrast of the color as picked, before adjustment, on the theme surface. */
  picked: number;
}

/** The accent family for one theme, adjusted to keep a 3:1 contrast. */
export function accentTokens(hex: string, theme: 'light' | 'dark'): AccentTokens {
  // Same move as the default palette: a touch lighter on dark backgrounds.
  const base = theme === 'dark' ? mix(hex, '#ffffff', 0.1) : hex;
  const accent = readable(base, theme);
  return {
    accent,
    deep: mix(accent, '#000000', 0.18),
    soft: mix(accent, BG[theme], theme === 'light' ? 0.88 : 0.84),
    onAccent: contrast(accent, '#ffffff') >= contrast(accent, INK) ? '#ffffff' : INK,
    picked: contrast(base, SURFACE[theme]),
  };
}

const vars = (t: AccentTokens) => `--accent:${t.accent};--accent-deep:${t.deep};--accent-soft:${t.soft};--on-accent:${t.onAccent};--s1:${t.accent};`;

/** CSS overriding the accent tokens for both themes; empty for the default accent. */
export function brandCss(b: Branding): string {
  if (!b.accent || b.accent === DEFAULT_ACCENT) return '';
  return `:root{${vars(accentTokens(b.accent, 'light'))}}@media (prefers-color-scheme: dark){:root{${vars(accentTokens(b.accent, 'dark'))}}}`;
}

// --- Store -------------------------------------------------------------------------------

const isBranding = (v: unknown): v is Branding => isObject(v);

export const brandingStore = createStore<Branding>('shipstat.branding.v1', {}, isBranding);
export const useBranding = () => useStore(brandingStore);

/** Applies the accent, the tab title and the favicon. Called on boot and on every change. */
export function applyBranding(raw: Branding) {
  const b = cleanBranding(raw);
  let style = document.getElementById('shipstat-brand');
  if (!style) {
    style = document.createElement('style');
    style.id = 'shipstat-brand';
    document.head.appendChild(style);
  }
  style.textContent = brandCss(b);
  document.title = b.name ? `${b.name} · Shipstat` : 'Shipstat';
  const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (icon) {
    icon.dataset.default ??= icon.href;
    icon.href = b.logo ?? icon.dataset.default;
    icon.type = b.logo ? '' : 'image/svg+xml';
  }
}
