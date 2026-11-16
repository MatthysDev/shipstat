/** Bayesian A/B comparison on conversion rates (Beta-Binomial, uniform prior). */

export interface Arm {
  key: string;
  exposed: number;
  converted: number;
}

export interface Comparison {
  control: Arm;
  arm: Arm;
  rateControl: number;
  rateArm: number;
  /** Relative uplift of arm vs control, median of the posterior (0.29 = +29 %). */
  uplift: number;
  /** 95 % credible interval of the relative uplift. */
  upliftLow: number;
  upliftHigh: number;
  /** Probability that arm converts better than control. */
  probBetter: number;
}

/** Mulberry32: small deterministic PRNG so results do not flicker between renders. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(rand: () => number) {
  let u = 0;
  while (u === 0) u = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

/** Marsaglia–Tsang gamma sampler (shape >= 1, scale 1). */
function gamma(shape: number, rand: () => number): number {
  if (shape < 1) return gamma(shape + 1, rand) * Math.pow(rand() || 1e-12, 1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number, v: number;
    do {
      x = normal(rand);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rand();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function beta(a: number, b: number, rand: () => number) {
  const x = gamma(a, rand);
  const y = gamma(b, rand);
  return x / (x + y);
}

function quantile(sorted: number[], q: number) {
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

export function compare(control: Arm, arm: Arm, samples = 20000, seed = 42): Comparison {
  const rand = rng(seed);
  const ups: number[] = new Array(samples);
  let better = 0;
  for (let i = 0; i < samples; i++) {
    const pc = beta(1 + control.converted, 1 + control.exposed - control.converted, rand);
    const pa = beta(1 + arm.converted, 1 + arm.exposed - arm.converted, rand);
    if (pa > pc) better++;
    ups[i] = pa / pc - 1;
  }
  ups.sort((x, y) => x - y);
  return {
    control,
    arm,
    rateControl: control.exposed ? control.converted / control.exposed : 0,
    rateArm: arm.exposed ? arm.converted / arm.exposed : 0,
    uplift: quantile(ups, 0.5),
    upliftLow: quantile(ups, 0.025),
    upliftHigh: quantile(ups, 0.975),
    probBetter: better / samples,
  };
}

/**
 * Rough number of extra exposures per arm needed to detect the observed difference
 * (two-sided 95 %, power 80 %). null when there is no difference to detect.
 */
export function exposuresNeeded(c: Comparison): number | null {
  const p1 = c.rateControl;
  const p2 = c.rateArm;
  if (p1 <= 0 || p2 <= 0 || p1 === p2) return null;
  const n = ((1.96 + 0.84) ** 2 * (p1 * (1 - p1) + p2 * (1 - p2))) / (p2 - p1) ** 2;
  const have = Math.min(c.control.exposed, c.arm.exposed);
  return Math.max(0, Math.ceil(n - have));
}
