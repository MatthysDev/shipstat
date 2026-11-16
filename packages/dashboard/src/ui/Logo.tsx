/** The Shipstat mark: an app-icon square, a step up, the event you track. Follows the theme. */
export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <rect width="64" height="64" rx="16" fill="var(--invert)" />
      <path d="M15 42h14V24h13" fill="none" stroke="var(--on-invert)" strokeWidth="6.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="49.5" cy="24" r="5" fill="var(--accent)" />
    </svg>
  );
}
