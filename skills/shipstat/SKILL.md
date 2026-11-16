---
name: shipstat
description: Use when adding analytics, event tracking or A/B testing to a React Native or Expo app with Shipstat, or when asked to instrument an app, write a tracking plan, or decide which events to track.
---

# Shipstat integration

Follow the integration guide in this skill's repository: `docs/ai/integrate.md` (also at https://github.com/MatthysDev/shipstat/blob/main/docs/ai/integrate.md).

Essentials:

1. `npx expo install shipstat`, rebuild the native app (not Expo Go).
2. `Shipstat.init({ endpoint })` once, at module level in the app entry.
3. `Shipstat.setContext({ variant, … })` before the first `track()`: module level or `useState` initializer, never only in a top-level `useEffect`.
4. `Shipstat.identify(internalUserId)` after sign-in, `identify(null)` on sign-out; wire consent to `setEnabled`.
5. Write a tracking plan of 10–25 events first (lifecycle, activation, core actions, monetization, retention), then place each `track()` where the outcome is known.
6. Names `snake_case` `object_action` past tense; flat props; no personal data; app version and device info are automatic.
7. Verify with `npx shipstat-dashboard` (Latest events, live), then define A/B tests in the dashboard.
