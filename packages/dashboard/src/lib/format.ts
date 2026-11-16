const nf = new Intl.NumberFormat('en-US');

export function fmtInt(n: number): string {
  return nf.format(Math.round(n));
}

export function fmtCompact(n: number): string {
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 1 : 2).replace(/\.?0+$/, '') + ' M';
  if (Math.abs(n) >= 1e4) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + ' k';
  return fmtInt(n);
}

export function fmtPct(x: number, digits = 1): string {
  return (x * 100).toFixed(digits) + ' %';
}

export function fmtSignedPct(x: number, digits = 0): string {
  const v = (x * 100).toFixed(digits);
  return (x > 0 ? '+' : x < 0 ? '−' : '') + v.replace('-', '') + ' %';
}

/** Change without sign: the arrow drawn by `.delta.up` / `.delta.down` carries the direction. */
export function fmtChange(x: number, digits = 1): string {
  return Math.abs(x * 100).toFixed(digits) + ' %';
}

export function fmtDay(d: Date): string {
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export function fmtAgo(d: Date, now = new Date()): string {
  const s = Math.max(0, Math.round((now.getTime() - d.getTime()) / 1000));
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
