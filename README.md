# Shipstat

**Open source analytics & A/B testing for React Native and Expo.**

Know if what you just shipped works better: compare events by app version and by variant.
No autocapture, no screen tracking, no session replay. Only the events you send.

- **Native module** (Swift + Kotlin): `track()` costs a few microseconds on the JS thread; events are stored in SQLite and sent in batches in the background, offline-safe.
- **Your API, your data**: events are posted as JSON to the endpoint you choose. Nobody else sees them.
- **Dashboard in your browser**: a static site that loads your events and analyses them with DuckDB-WASM. Nothing to host, or host it yourself.
- **A/B tests by version**: Bayesian comparison of variants, overall and per app version.

## Quick start

```sh
npx expo install shipstat
```

```ts
import Shipstat from 'shipstat';

Shipstat.init({
  endpoint: 'https://api.example.com/events',
  headers: { Authorization: `Bearer ${token}` },
});

Shipstat.setContext({ variant: 'B', feature: 'paywall_v2' }); // added to every following event
Shipstat.track('paywall_viewed', { placement: 'onboarding_end' });
```

`app_version`, `build`, `ota` (expo-updates), `platform`, `os_version`, `device_model`, `locale` and `sdk_version` are added automatically.

API: `init`, `track`, `setContext`, `unsetContext`, `identify`, `setEnabled`, `reset`, `flush`, `getAnonId`.

## Receiving events

Your endpoint receives `POST` batches in the format described in [`packages/schema`](packages/schema) (`event-batch.schema.json`).
Reply 2xx to accept a batch. 4xx (except 408/429) drops it; 408, 429, 5xx and network errors are retried with backoff (`Retry-After` respected).

No API yet? [`examples/dev-server`](examples/dev-server) is a zero-dependency Node server that ingests events and serves them back to the dashboard:

```sh
node examples/dev-server/server.mjs --token dev-token
```

## Dashboard

```sh
pnpm install
pnpm --filter shipstat-dashboard dev
```

Load events from your API (`GET <url>?since=<cursor>&limit=5000` → `{ events, next_cursor }`), a CSV / JSON / Parquet export, Supabase, or demo data.

Self-host: `pnpm --filter shipstat-dashboard build` gives a static `dist/`, or use the [Dockerfile](packages/dashboard/Dockerfile).

## Repository

| Path | What |
|---|---|
| `packages/sdk` | Expo module `shipstat` (TypeScript, Swift, Kotlin) |
| `packages/schema` | Event types and JSON Schema |
| `packages/dashboard` | Static dashboard, DuckDB-WASM |
| `apps/example` | Example app with a benchmark |
| `examples/dev-server` | Local ingest + read server |
| `docs/` | Design document |

## Status

Early. Measured on simulators in debug builds: `track()` ≈ 2–3 µs on iOS, 20–40 µs on Android.

## License

MIT
