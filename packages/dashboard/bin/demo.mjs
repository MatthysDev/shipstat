// Synthetic events shaped like a real fitness app: three releases, a paywall A/B test with a
// stronger effect on the newest version, an onboarding funnel. Shared by the dashboard
// ("Demo data") and `shipstat-dashboard --demo`.

/** Mulberry32: small deterministic PRNG. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function demoEvents(days = 45, users = 3200, seed = 7, now = Date.now()) {
  const rand = rng(seed);
  const pick = (xs) => xs[Math.floor(rand() * xs.length)];
  const start = now - days * 86400_000;
  const out = [];
  let n = 0;
  const id = () => `demo-${seed}-${n++}`;
  for (let u = 0; u < users; u++) {
    const anon = `anon-${u}`;
    const firstSeen = start + rand() * (days - 1) * 86400_000;
    const platform = rand() < 0.64 ? 'ios' : 'android';
    const variant = rand() < 0.5 ? 'A' : 'B';
    const locale = pick(['en-US', 'en-US', 'fr-FR', 'de-DE', 'es-ES']);
    const device = platform === 'ios' ? pick(['iPhone16,2', 'iPhone15,3', 'iPhone17,1']) : pick(['Google Pixel 9', 'Samsung SM-S921B']);
    const osVersion = platform === 'ios' ? pick(['26.1', '26.0', '18.6']) : pick(['16', '15', '14']);
    const sessions = 1 + Math.floor(rand() * 9);
    for (let s = 0; s < sessions; s++) {
      const t0 = firstSeen + s * (0.5 + rand() * 2.5) * 86400_000;
      if (t0 > now) break;
      // 2.3.0 ships 12 days before the end and takes over progressively.
      const release = now - 12 * 86400_000;
      const share = Math.max(0, Math.min(1, (t0 - release) / (8 * 86400_000))) * 0.75;
      const app_version = rand() < share ? '2.3.0' : rand() < 0.85 ? '2.2.1' : '2.2.0';
      const context = {
        app_version,
        build: app_version === '2.3.0' ? '412' : app_version === '2.2.1' ? '398' : '377',
        platform,
        os_version: osVersion,
        device_model: device,
        locale,
        sdk_version: '0.1.0',
        variant,
        feature: 'paywall_v2',
      };
      let t = t0;
      const ev = (name, props = {}) => {
        t += (5 + rand() * 90) * 1000;
        if (t > now) return;
        out.push({ id: id(), name, ts: new Date(t).toISOString(), anon_id: anon, user_id: null, props, context });
      };
      ev('app_opened');
      if (s === 0) for (let k = 1; k <= 4; k++) if (rand() < 0.9) ev('onboarding_step', { step: k });
      const workouts = Math.floor(rand() * 3);
      for (let w = 0; w < workouts; w++) {
        ev('workout_started', { program_id: pick(['p1', 'p2', 'p3']), source: pick(['home', 'plan']) });
        const sets = 3 + Math.floor(rand() * 8);
        for (let k = 0; k < sets; k++) ev('set_logged', { exercise: pick(['squat', 'bench', 'row', 'deadlift']), reps: 5 + Math.floor(rand() * 8), weight: 20 + Math.floor(rand() * 80) });
      }
      if (rand() < 0.35) {
        ev('paywall_viewed', { placement: pick(['onboarding_end', 'settings', 'locked_feature']) });
        const base = 0.042 * (app_version === '2.3.0' ? 1.05 : 1);
        const lift = variant === 'B' ? (app_version === '2.3.0' ? 1.35 : 1.12) : 1;
        if (rand() < base * lift * 2.2) ev('purchase_done', { plan: pick(['monthly', 'yearly']), price: pick([9.99, 59.99]), currency: 'USD' });
      }
      if (rand() < 0.05) ev('share_tapped', { target: pick(['instagram', 'messages']) });
    }
  }
  return out;
}

/**
 * A shared workspace for the demo: the tracking plan of the fake fitness app and a board
 * written as a report. Served by `shipstat-dashboard --demo` and applied by `?demo`.
 */
export function demoWorkspace() {
  const w = (id, x) => ({ id: `demo-${id}`, metric: 'events', range: '30d', filters: {}, size: 1, ...x });
  return {
    shipstat: 'workspace',
    version: 1,
    catalog: {
      events: {
        app_opened: { description: 'The app came to the foreground: cold start or resume.', trigger: 'on launch and on every return from background', owner: 'Core', category: 'lifecycle' },
        onboarding_step: { description: 'A screen of the onboarding was completed.', trigger: 'when the user taps Continue', owner: 'Growth', category: 'onboarding', props: { step: '1 to 4, in order' } },
        workout_started: { description: 'The user started a workout from a program.', trigger: 'when the timer starts', owner: 'Training', category: 'engagement', props: { program_id: 'Program the workout belongs to', source: 'home (suggested) or plan (scheduled)' } },
        set_logged: { description: 'One set of an exercise was saved.', trigger: 'when the user checks the set', owner: 'Training', category: 'engagement', props: { exercise: 'Exercise slug', reps: 'Repetitions done', weight: 'Load in kg' } },
        paywall_viewed: { description: 'The paywall sheet was shown. Exposure event of the paywall test.', trigger: 'when the sheet finishes opening', owner: 'Growth', category: 'monetization', props: { placement: 'Where it opened: onboarding_end, settings or locked_feature' } },
        purchase_done: { description: 'A subscription was paid and confirmed by the store.', trigger: 'after the store receipt is validated', owner: 'Growth', category: 'monetization', props: { plan: 'monthly or yearly', price: 'Price paid, in currency', currency: 'ISO code' } },
      },
      keys: {
        variant: 'Paywall test arm, A (control) or B (new paywall)',
        feature: 'Experiment the variant belongs to',
        app_version: 'Marketing version of the app',
      },
    },
    boards: [
      {
        id: 'demo-report',
        name: 'Paywall report',
        description: 'Does the new paywall (B) sell more than the old one (A)? Read top to bottom: reach, what people do after seeing it, and conversion per arm. Updated live from the app.',
        widgets: [
          w('users', { title: 'People who saw the paywall', viz: 'number', metric: 'users', event: 'paywall_viewed', note: 'Exposure: everyone counted in the test.' }),
          w('buyers', { title: 'Buyers', viz: 'number', metric: 'users', event: 'purchase_done' }),
          w('placement', { title: 'Where the paywall opens', viz: 'pie', split: 'placement', metric: 'users', event: 'paywall_viewed', note: 'Most exposures come from the end of onboarding.' }),
          w('after', { title: 'After the paywall', viz: 'paths', event: 'paywall_viewed', direction: 'after', depth: 3, metric: 'users', size: 3, note: 'Most people close the app or go back to training; the purchase branch is the one to grow.' }),
          w('funnel', { title: 'Conversion by variant', viz: 'funnel', steps: ['app_opened', 'paywall_viewed', 'purchase_done'], split: 'variant', metric: 'users', size: 2, note: 'B converts better at the last step; see A/B tests for the probability.' }),
          w('buyers-variant', { title: 'Buyers per day by variant', viz: 'line', split: 'variant', metric: 'users', event: 'purchase_done' }),
        ],
      },
    ],
  };
}
