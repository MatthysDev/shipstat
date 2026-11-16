# Shipstat — design

## Intent

Hosted mobile analytics tools capture everything: navigation, screens, sessions. Shipstat does the opposite:

- you send **only the events you choose**, with tags that are easy to set;
- every event carries its **app version and variant**, so any number can be compared across releases and A/B variants;
- tracking costs **almost nothing** on the app (native module, off the JS thread);
- it is **open source and free**: each user hosts their own data, the project runs no servers.

The question it answers: *did what I just shipped (a version, a variant) work better?*

## Goals

- A native Expo module (Swift and Kotlin): `track`, global context, anonymous id, on-disk queue, batched background uploads.
- A documented, versioned event format any backend can receive.
- A static dashboard that loads events and analyses them **in the browser** (DuckDB-WASM): boards, event breakdowns, funnels, A/B tests.
- A zero-setup local stack: `npx shipstat-dashboard` receives events and serves the dashboard, live.
- Self-hostable dashboard (static build, Docker).

## Non-goals

- Autocapture (navigation, screens, taps, sessions, crashes), heatmaps, session replay.
- Remote variant assignment (feature flags): the variant is set by the app or its flag provider.
- A hosted service that stores other people's data; a server-side analytics engine.
- Web / React Native Web support for the module.

## Anti-goals

Failure even if it "works":

- the module measurably slows the JS or UI thread;
- the project costs its maintainer money to run;
- data goes anywhere the developer did not configure;
- setup takes more than installing the package, setting an URL and running one command.

## Approaches considered

**Where data lives and where analysis happens**

1. *Send to an existing product (e.g. PostHog)*: fast to build, but not a product of its own. Rejected.
2. *A backend each user hosts, with a server-side dashboard*: complete, but heavy to install and run. Rejected for now.
3. **Chosen: the module posts to the user's API; a static dashboard analyses in the browser with DuckDB.** Nobody pays for analytics servers, data never leaves the viewer's machine, the dashboard can be hosted for free or self-hosted. Limit: past a few tens of millions of loaded events, the browser is the bottleneck; a server engine can come later.

**Module: native or JavaScript**

- *Pure JS* (AsyncStorage + fetch): simpler, but serialization and I/O on the JS thread. Rejected.
- **Chosen: native.** JS hands over the name, a JSON string of props and a timestamp in one JSI call; native code does ids, context, SQLite and the network on a background queue.

## Module

- API: `init`, `track`, `setContext`, `unsetContext`, `identify`, `setEnabled`, `reset`, `flush`, `getAnonId` (see the README).
- Automatic context: `app_version`, `build`, `ota` (expo-updates), `platform`, `os_version`, `device_model`, `locale`, `sdk_version`. No IDFA/GAID, IP or personal data.
- Storage: SQLite queue on a serial queue (iOS) / single-thread executor (Android). Bursts of `track()` share one transaction.
- Upload: when `flushAt` events wait, every `flushIntervalMs`, and when the app goes to the background. 2xx deletes the batch; 4xx (except 408/429) drops it; 408/429/5xx/network errors retry with exponential backoff (max 5 min), honoring `Retry-After`. Optional gzip.
- Offline: the queue grows to `maxQueueSize`, then the oldest events are dropped.
- Opt-out (`setEnabled(false)`) deletes waiting events and stops tracking; persisted.
- Targets: `track()` well under 100 µs on the JS thread (measured ≈ 1 µs), no I/O on the UI thread.

## Event format (v1)

`POST <endpoint>`: `{ "schema": 1, "sent_at", "events": [{ id, name, ts, anon_id, user_id, props, context }] }`. `id` is a UUID for deduplication, `ts` the client time in ISO 8601 UTC. Developer context and automatic keys share `context`; automatic keys win on conflict. Types and JSON Schema in `packages/schema`.

Read contract for the dashboard: `GET <read_url>?since=<cursor>&limit=<n>` → `{ events, next_cursor }`.

## Dashboard

- Sources: a read API (incremental, live mode), a CSV / JSON / Parquet file, Supabase, demo data. Loaded events are cached in the browser (OPFS).
- Boards of configurable widgets (line, bars, number, donut, table, funnel, live feed), exportable as JSON.
- Identity: an install's anonymous events are linked to its `user_id` once `identify()` is called.
- A/B tests: exposure event, goal event, variant key. Conversion = share of exposed users reaching the goal after their first exposure. Beta-Binomial posterior: probability to beat control, relative uplift with a 95 % interval, the same per app version, and an estimate of the exposures still needed.

## Repository

`packages/sdk` (module), `packages/schema`, `packages/dashboard` (dashboard and `shipstat-dashboard`), `apps/example` (example app and Perf lab), `apps/site` (landing), `examples/playground` (external-style test app), `docs`, `scripts/media`.
