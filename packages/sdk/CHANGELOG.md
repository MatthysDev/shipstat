# Changelog

## Unreleased

- Lighter on battery: the upload timer only runs while events wait (no wake-up at all when idle), `flushIntervalMs` defaults to 30 s instead of 10 s so the radio wakes up a third as often, and retries never come sooner than that interval.
- `compress` defaults to true. An endpoint that answers a gzipped batch with an error gets it again as plain JSON, and the session stays plain.
- SQLite `synchronous=NORMAL` (with WAL): no fsync per write.
- `shipstat/vexo`: drop-in replacement for `vexo-analytics` (`vexo`, `customEvent`, `identifyDevice`, `enableTracking`, `disableTracking`, `trackScreen`, `trackError`; replay and heatmap calls are accepted and ignored).

## 0.1.0

- Writes are batched: a burst of `track()` calls becomes one SQLite transaction with a reused statement (≈ 23× less disk time per event in bursts).
- `compress: true` gzips each batch (`Content-Encoding: gzip`), typically 10–20× fewer bytes on the network.
- Opt-out deletes waiting events; NaN / Infinity in context are dropped instead of crashing; `track()` never throws.

- First version: native event queue (SQLite) and batched uploads on iOS and Android.
- `track`, `setContext`, `unsetContext`, `identify`, `setEnabled`, `reset`, `flush`, `getAnonId`.
- Automatic context: app version, build, OTA update id, platform, OS version, device model, locale.
