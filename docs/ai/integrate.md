# Add Shipstat analytics to this app

You are adding Shipstat (open source analytics & A/B testing for React Native and Expo) to this codebase. Work in this order and keep the diff small.

## 1. Install

- Expo: `npx expo install shipstat`. Bare React Native: `npm install shipstat` then `npx pod-install`.
- It is a native module: rebuild the app (`npx expo run:ios` / `run:android`, or a new EAS dev build). It does not run in Expo Go.

## 2. Initialize once, before anything renders

In the app entry (`app/_layout.tsx` for Expo Router, otherwise `App.tsx` or `index.js`), at module level, not inside a component:

```ts
import Shipstat from 'shipstat';

Shipstat.init({
  endpoint: process.env.EXPO_PUBLIC_SHIPSTAT_ENDPOINT!, // e.g. https://api.example.com/events
  headers: { Authorization: `Bearer ${process.env.EXPO_PUBLIC_SHIPSTAT_KEY}` },
  compress: true, // only if the endpoint accepts gzip bodies
});
```

For local testing, `npx shipstat-dashboard` receives events on `http://localhost:8787/events` (iOS simulator), `http://10.0.2.2:8787/events` (Android emulator), or the Mac's LAN IP (device).

## 3. Context: set it before the first `track()`

Context is merged into every following event. Set it at module level or in a `useState` initializer, never only in a top-level `useEffect`: React runs child effects before parent effects, so the first events of child screens would miss it.

```ts
Shipstat.setContext({ variant: getPaywallVariant(), feature: 'paywall_v2' });
```

Use context for things that describe the session (A/B variant, plan tier, feature flags), props for things that describe one event.

## 4. Identity

- After sign-in: `Shipstat.identify(user.id)` (an internal id, never an email or a name).
- On sign-out: `Shipstat.identify(null)` then `Shipstat.reset()` if the next user may differ.
- If the app has an analytics consent setting, wire it to `Shipstat.setEnabled(bool)`; disabling deletes events waiting on the device.

## 5. Choose what to track (write the plan first)

Read the navigation and the main user flows, then propose a tracking plan of **10 to 25 events**, as a table: event, where it fires (file and function), props, why it matters. Cover:

1. **Lifecycle**: `app_opened` (once per cold start).
2. **Activation**: each onboarding step (`onboarding_step` with `step`), `onboarding_completed`, sign-up / sign-in.
3. **Core value**: the 3 to 5 actions that mean the app is used for what it is for (`workout_started`, `message_sent`, `order_placed`…).
4. **Monetization**: `paywall_viewed` (with `placement`), `purchase_started`, `purchase_done` (`plan`, `price`, `currency`), `purchase_failed` (`reason`), `subscription_cancelled`.
5. **Retention and quality**: `notification_opened`, `share_tapped`, error states the user sees (`error_shown` with a `code`).

Do not track every screen or tap: Shipstat has no autocapture on purpose. Track decisions and outcomes.

## 6. Naming and props

- Event names: `snake_case`, `object_action`, past tense for things that happened (`purchase_done`, `paywall_viewed`). Keep names stable: they become dashboard queries.
- Props are flat: strings, numbers, booleans, `null`, or arrays of them. No nested objects.
- Prefer small enums (`placement: 'onboarding_end' | 'settings'`) over free text.
- Never send personal data: no emails, names, phone numbers, addresses, free-text inputs, tokens.
- App version, build, OTA update id, platform, OS version, device model and locale are added automatically: do not add them.

## 7. Where to put the calls

- Fire events where the outcome is known: in the success branch of the purchase / submit handler, not on button press.
- For screens that matter (paywall, onboarding steps), fire in the screen's mount effect (`useEffect(() => { Shipstat.track('paywall_viewed', { placement }) }, [])`) or a focus listener for tab screens.
- Keep calls out of render functions and loops. `track()` is cheap (≈ 1 µs) but should fire once per real event.
- Optionally wrap names in a typed helper (`analytics.ts` exporting `track<E extends keyof Events>(…)`) so the plan lives in one file.

## 8. Verify

Run `npx shipstat-dashboard`, point `endpoint` at it, use the app, and check that each event of the plan appears in **Latest events** with the expected props and context. Then define the A/B test in the dashboard: exposure `paywall_viewed`, goal `purchase_done`, variant key `variant`.

Finish with a short summary: the tracking plan table, the files changed, and anything you could not place.
