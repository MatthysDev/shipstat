# Shipstat, Vexo and PostHog for a mobile app

Shipstat does one thing: it moves the events you choose from your app to your server, as cheaply as possible for the app. The dashboard is yours to shape and share. This page is the honest comparison: what you gain, what it costs, what you give up.

**Short version.** If you mostly read your own custom events (activation, retention, A/B tests by release), Shipstat is the fastest client we measured, costs the price of one small server, and keeps the data with you. If you need session replay, heatmaps, crash reporting or remote feature flags, keep Vexo or PostHog for that part.

## Performance on the JS thread

Same app, same run, release build on the iOS simulator. Each SDK is set up the way its docs show and receives the same event (`bench_event` with three props). 10 000 calls timed one by one, best of 3, three runs; medians below. Raw data: [`perf/vs-sdks.json`](perf/vs-sdks.json), [`perf/vs-sdks-raw.ndjson`](perf/vs-sdks-raw.ndjson). Harness: [`apps/example/src/bench.ts`](../apps/example/src/bench.ts).

| One `track()` call | p50 | p99 | Frames at 6 000 events/s |
|---|---|---|---|
| **Shipstat** 0.1 (native queue) | **1.6 µs** | **4.2 µs** | **60 fps** |
| Vexo 1.14 (`customEvent`) | 3.8 µs | 5.5 µs | 60 fps |
| PostHog RN 4.87 (`capture`) | 113 µs | 341 µs | 43 fps, 74 long frames in 3 s |
| Minimal JS client (baseline) | 10.1 µs | 96.5 µs | 60 fps |

- **PostHog is ~70× slower per call.** Its whole pipeline (properties, ids, queue, persistence) runs in JavaScript inside `capture()`. At high rates it drops frames.
- **Vexo returns fast, then keeps working.** `customEvent` hands the event to an async JavaScript pipeline (building, a mutex, a JS batch queue, then `fetch` from JS). Part of that work runs after the call returns, so the per-call number flatters it. In our run Vexo had a placeholder key, so its batches were dropped before upload; with a real key it also serialises and sends from the JS thread. It still held 60 fps in the burst test.
- **Shipstat** serialises the props once, makes one JSI call, and everything else (ids, context, SQLite, gzip, network, retries) runs on a native background queue.
- The host had 8 other simulators running, so absolute values are ~1.8× higher than in the [main study](perf/README.md) (0.9 µs for Shipstat). Read the ratios.

Not measured here: Android (planned), memory, and session replay costs (Vexo and PostHog both turn replay on by default; it was disabled for this run).

## Cost per month

`node scripts/costs.mjs` prints this table from the vendors' public price lists ([PostHog](https://posthog.com/pricing), [Vexo](https://docs.vexo.co/settings/subscription), [Hetzner](https://www.hetzner.com/cloud/cost-optimized/)), checked on 2026-11-17. Assumption: 100 custom events per monthly active user.

| Monthly active users | Events / month | Shipstat | Vexo, custom events only | Vexo, ×3 with autocapture | PostHog, anonymous | PostHog, identified |
|---|---|---|---|---|---|---|
| 1,000 | 0.1 M | $7 | $0 | $0 | $0 | $0 |
| 10,000 | 1 M | $7 | $15 | $75 | $0 | $0 |
| 50,000 | 5 M | $7 | $135 | $395 | $153 | $560 |
| 100,000 | 10 M | $7 | $285 | $725 | $324 | $1,080 |
| 500,000 | 50 M | $8 | $1,165 | $2,765 | $1,528 | $3,893 |

How to read it:

- **Past a few million events a month**, the dashboard should query on the server rather than load everything in the browser (planned with the production mode); the same server does it.
- **Small apps pay nothing anywhere.** Below ~5 000 active users, PostHog's free million and Vexo's free 500 000 cover you. Shipstat's argument there is the data and the speed, not the price.
- **Vexo bills what it captures, not only what you send.** Taps, screens, network requests, errors, performance samples and console messages are on by default and all count. The "×3" column is an illustration; check your own ratio in Vexo's usage page.
- **PostHog bills identified events twice.** Events sent after `identify()` pay an add-on on top of the event price; anonymous ones do not.
- **Shipstat is one small server.** A Hetzner CX23 (2 vCPU, 4 GB, 40 GB disk, €5.99 ≈ $7) is far more than ingest needs: 50 M events a month is ~19 events/s on average, and one process takes ~15 000/s (measured, 20 000 gzipped events in batches of 100). What grows is storage: ~75 bytes per event gzipped (~430 as plain NDJSON). Twelve months at 50 M events a month is ~45 GB, so a few GB of volume on top ($0.15/GB-month at Railway or Fly.io). Railway ($5), Fly.io (from ~$2) and Render ($7 + disk) work too. Not counted: your time to run it.

## What you give up

| | Shipstat | Vexo | PostHog |
|---|---|---|---|
| Custom events, identify, opt-out | ✅ | ✅ | ✅ |
| Release, build and OTA update on every event | ✅ | partly | version and build |
| Data on your own server | ✅ | ❌ | self-host possible |
| A/B results by variant and by release | ✅ (variants set in your code) | not in its docs | ✅ |
| Remote feature flags | ❌ | ❌ | ✅ |
| Screens and taps captured automatically | ❌ by design | ✅ | ✅ |
| Session replay, heatmaps | ❌ | ✅ | ✅ |
| Crash and error reporting | ❌ | ✅ | ✅ |
| Dashboards | in the browser, yours to customise and share | ✅ | ✅ |
| Maintenance | you | them | them |

## Switching

Nothing is lost: run both SDKs for one release, compare counts, then import your history.

- [From Vexo](migrate/vexo.md): `import … from 'shipstat/vexo'` keeps every Vexo call working; `npx shipstat-dashboard import vexo` pulls your events from Vexo's export API.
- [From PostHog](migrate/posthog.md): one wrapper to change; `npx shipstat-dashboard import posthog` pulls your events through PostHog's file exports.
