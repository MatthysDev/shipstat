// Monthly cost of mobile analytics, from each vendor's public price list.
// Prices checked on 2026-11-17: https://posthog.com/pricing, https://docs.vexo.co/settings/subscription,
// https://www.hetzner.com/cloud/cost-optimized/. Used by the landing page and scripts/costs.mjs.

export const CHECKED = '2026-11-17';

/** Sum a volume over price tiers: [[upTo, pricePerEvent], ...], the last upTo being Infinity. */
function tiered(volume, tiers) {
  let total = 0;
  let from = 0;
  for (const [upTo, price] of tiers) {
    if (volume <= from) break;
    total += (Math.min(volume, upTo) - from) * price;
    from = upTo;
  }
  return total;
}

const M = 1_000_000;

/** PostHog product analytics. Identified events (after identify()) pay an add-on on top. */
export function posthog(events, identifiedShare = 1) {
  const base = tiered(events, [[M, 0], [2 * M, 0.00005], [15 * M, 0.0000343], [50 * M, 0.0000295], [100 * M, 0.0000218], [250 * M, 0.000015], [Infinity, 0.000009]]);
  const identified = tiered(events * identifiedShare, [[M, 0], [2 * M, 0.000198], [15 * M, 0.0000697], [50 * M, 0.000036], [100 * M, 0.0000146], [250 * M, 0.0000037], [Infinity, 0.000001]]);
  return base + identified;
}

/**
 * Vexo bills every captured event: taps, screens, network requests, errors, performance samples
 * and console messages are on by default, on top of your custom events. `autoFactor` is how many
 * billable events each custom event comes with (1 = custom events only, a floor).
 */
export function vexo(events, autoFactor = 1) {
  return tiered(events * autoFactor, [[0.5 * M, 0], [10 * M, 0.00003], [50 * M, 0.000022], [150 * M, 0.000016], [Infinity, 0.000012]]);
}

/**
 * Shipstat: one server you rent. A Hetzner CX23 (2 vCPU, 4 GB, 40 GB disk, €5.99 ≈ $7) is far
 * more than ingest needs: 50 M events a month is ~19 events/s on average, and one process takes
 * ~15 000/s (measured). What grows is storage, ~75 bytes per event gzipped (measured): kept
 * `retentionMonths`, anything past the 40 GB disk is billed as a volume at $0.15/GB-month
 * (Railway's and Fly.io's price; a conservative figure).
 */
export function shipstat(events, retentionMonths = 12) {
  const storedGb = (events * retentionMonths * 75) / 1e9;
  return 7 + Math.max(0, storedGb - 40) * 0.15;
}

export function compare({ users, eventsPerUser, identifiedShare = 1, vexoAutoFactor = 1 }) {
  const events = users * eventsPerUser;
  return { events, shipstat: shipstat(events), vexo: vexo(events, vexoAutoFactor), posthog: posthog(events, identifiedShare) };
}
