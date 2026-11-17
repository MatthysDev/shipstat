// Prints the monthly cost table used in docs/compare.md: node scripts/costs.mjs
import { CHECKED, compare } from '../apps/site/costs.js';

const usd = (n) => (n < 1 ? '$0' : `$${Math.round(n).toLocaleString('en-US')}`);
const rows = [1_000, 10_000, 50_000, 100_000, 500_000];
console.log(`Prices checked ${CHECKED}. 100 custom events per active user per month.\n`);
console.log('| Monthly active users | Events / month | Shipstat | Vexo, custom events only | Vexo, ×3 with autocapture | PostHog, anonymous | PostHog, identified |');
console.log('|---|---|---|---|---|---|---|');
for (const users of rows) {
  const a = compare({ users, eventsPerUser: 100, identifiedShare: 0 });
  const b = compare({ users, eventsPerUser: 100, identifiedShare: 1, vexoAutoFactor: 3 });
  console.log(`| ${users.toLocaleString('en-US')} | ${(a.events / 1e6).toLocaleString('en-US')} M | ${usd(a.shipstat)} | ${usd(a.vexo)} | ${usd(b.vexo)} | ${usd(a.posthog)} | ${usd(b.posthog)} |`);
}
