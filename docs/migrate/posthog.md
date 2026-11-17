# Migrate from PostHog (mobile)

This guide is for the **mobile app** part of a PostHog setup. PostHog does much more than events (web analytics, session replay, error tracking, remote feature flags, surveys). Keep it for what you use there; move the mobile product events to Shipstat if you want them on your own server, with no quota and nothing on the JS thread.

| | PostHog (`posthog-react-native`) | Shipstat |
|---|---|---|
| Custom events, identify, opt-out | ✅ | ✅ |
| Where the work happens | JavaScript queue, persisted from JS | native queue (SQLite), off the JS thread |
| Version, build, OTA update on every event | version and build | ✅ version, build and `expo-updates` id |
| Remote feature flags | ✅ | ❌ assign variants in your code or keep your flag provider |
| Error tracking, session replay | ✅ | ❌ |
| Where the data lives | PostHog Cloud (US or EU) or your PostHog | your server or database |
| Price | free tier, then per event | your hosting |

## 1. Map the calls

| PostHog | Shipstat |
|---|---|
| `new PostHog(key, { host })` / `<PostHogProvider>` | `Shipstat.init({ endpoint })` once, at module scope of the root layout |
| `posthog.capture(name, props)` | `Shipstat.track(name, props)`; props are flat (`{ 'cart.total': 3 }`) |
| `posthog.identify(userId)` | `Shipstat.identify(userId)` |
| `posthog.reset()` | `Shipstat.reset()` |
| `posthog.register({ plan })` (super properties) | `Shipstat.setContext({ plan })` |
| `posthog.unregister('plan')` | `Shipstat.unsetContext('plan')` |
| `posthog.optOut()` / `optIn()` | `Shipstat.setEnabled(false / true)` |
| `posthog.screen(name)` | `Shipstat.track('screen_viewed', { screen: name })` where it matters |
| `posthog.flush()` | `Shipstat.flush()` |
| `posthog.getFeatureFlag('paywall')` | keep it, then `Shipstat.setContext({ paywall: variant })`: the dashboard compares variants |

The usual pattern is a single wrapper that every screen calls. Change it once:

```diff
- import { posthog } from '@/lib/posthog';
+ import Shipstat from 'shipstat';

  export function trackEvent(name: string, props?: Record<string, string | number | boolean | null>) {
-   posthog.capture(name, props);
+   Shipstat.track(name, props);
  }
```

Error tracking can stay on PostHog: keep `posthog.captureException` and the provider, and remove only the `capture` calls.

## 2. Run both for one release (recommended)

Send each event to both for one release, then compare daily counts of a few events. They should match within a few percent.

```ts
export function trackEvent(name: string, props?: Record<string, string | number | boolean | null>) {
  posthog.capture(name, props);
  Shipstat.track(name, props);
}
```

## 3. Bring your history

Straight from PostHog, through its [file exports](https://posthog.com/docs/data-pipelines/file-download-exports) (the method PostHog recommends for bulk exports):

```sh
npx shipstat-dashboard import posthog \
  --host https://eu.posthog.com \
  --project 12345 \
  --key phx_your_personal_api_key \
  --dry-run
```

Remove `--dry-run` to write the events. Then `npx shipstat-dashboard` shows them next to the new ones.

- **The key** is a *personal* API key (PostHog → Settings → Personal API keys) with the `batch_export:read` and `batch_export:write` scopes. The `phc_` project key in your app cannot read data.
- **How it works**: one export per week of data, JSON Lines, gzipped. The command waits for each one, downloads it, converts it, and moves to the next week. It stops one hour before now so late events are not missed.
- **Cost**: PostHog bills exported rows past its free allowance (first million free). To avoid it, `--via query` uses the Query API instead (scope `query:read`): free, slower, and PostHog may rate-limit it since it is not meant for exports.
- **Host**: `https://eu.posthog.com` or `https://us.posthog.com`, or your self-hosted URL. **Project id**: the number in your PostHog URLs (`/project/12345/`).
- **Only some events or dates**: `--events session_completed,food_logged`, `--since 2025-01-01`, `--until 2026-01-01`.
- **Interrupted, or run twice?** Nothing is duplicated: ids are derived from PostHog's `uuid`. Run the same command again.
- **PostHog bookkeeping** (`$identify`, `$set`, `$feature_flag_called`, `$autocapture`…) is skipped; `--all` keeps it. `$screen` becomes `screen_viewed`, `$exception` becomes `error`.
- **Mapping**: `$app_version` → `app_version`, `$app_build` → `build`, `$os_name` → `platform`, `$os_version`, `$device_name` → `device_model`, `$locale`. Other `$` properties are dropped; your own properties are kept, flattened. Events after `identify()` keep your user id in `user_id`.
- **Your own database**: `--out history.ndjson` writes one Shipstat event per line, ready to load.
- **From a file** you already have (CSV, JSON or JSON Lines with `uuid`, `event`, `timestamp`, `distinct_id`, `properties`): `npx shipstat-dashboard import posthog --file events.csv`.

## Checklist

- [ ] `shipstat` installed, app rebuilt
- [ ] wrapper switched (or both SDKs for one release, counts compared)
- [ ] super properties moved to `setContext`, flags kept and their variant set in context
- [ ] history imported with `import posthog`
- [ ] `posthog-react-native` removed from the app, or kept only for errors
