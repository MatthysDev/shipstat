import { rng } from './stats';

/** Synthetic events shaped like a real app, so the dashboard can be tried without any setup. */
export function demoEvents(days = 30, users = 2400, seed = 7) {
  const rand = rng(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const now = Date.now();
  const start = now - days * 86400_000;
  const out: object[] = [];
  let n = 0;
  const id = () => `demo-${seed}-${n++}`;
  for (let u = 0; u < users; u++) {
    const anon = `anon-${u}`;
    const firstSeen = start + rand() * (days - 1) * 86400_000;
    const platform = rand() < 0.64 ? 'ios' : 'android';
    const variant = rand() < 0.5 ? 'A' : 'B';
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
        os_version: platform === 'ios' ? pick(['26.1', '26.0', '18.6']) : pick(['16', '15', '14']),
        device_model: platform === 'ios' ? pick(['iPhone16,2', 'iPhone15,3', 'iPhone17,1']) : pick(['Google Pixel 9', 'Samsung SM-S921B']),
        locale: pick(['en-US', 'fr-FR', 'de-DE', 'es-ES']),
        sdk_version: '0.1.0',
        variant,
        feature: 'paywall_v2',
      };
      let t = t0;
      const ev = (name: string, props: Record<string, unknown> = {}) => {
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
