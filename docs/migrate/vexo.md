# Migrate from Vexo

Two edits in your code, one command for your history, and nothing lost on the way.

| | Vexo | Shipstat |
|---|---|---|
| Your custom events | ✅ | ✅ same names, same props |
| Where the data lives | Vexo's servers | your server or database |
| Version, build, OTA update on every event | partly | ✅ automatic |
| Screens, taps, heatmaps, session replay | ✅ automatic | ❌ not captured (you track what matters) |
| Crash reporting | ✅ | ❌ keep a crash reporter |
| Price | per plan | your hosting |

If you rely on session replay or heatmaps every week, stay on Vexo. If you mostly read your custom events, read on.

## 1. Switch the SDK (5 minutes)

```sh
npx expo install shipstat
```

`shipstat/vexo` exposes the same functions as `vexo-analytics`. Change the import, and put your endpoint where the Vexo key was:

```diff
- import { vexo, customEvent, identifyDevice } from 'vexo-analytics';
+ import { vexo, customEvent, identifyDevice } from 'shipstat/vexo';

- vexo('YOUR_VEXO_KEY');
+ vexo('https://stats.example.com/events');
```

Every call keeps working:

| Vexo call | With `shipstat/vexo` |
|---|---|
| `vexo(key, options)` | starts Shipstat; pass your endpoint URL or a full `init` config |
| `customEvent(name, args)` | `track(name, args)`; nested objects become `a.b` keys |
| `identifyDevice(id)` | `identify(id)`. Pass an internal user id rather than an email |
| `enableTracking()` / `disableTracking()` | `setEnabled(true / false)`, persisted |
| `trackScreen(name, props)` | a `screen_viewed` event with `screen: name` |
| `trackError(error)` | an `error` event with the message (no stack trace) |
| `setHeatmapSegment`, `VexoMask`, `VexoUnmask`, `VexoProvider` | accepted, do nothing |

Then rebuild the app (`npx expo run:ios`, or your EAS build): Shipstat is a native module, an OTA update alone cannot add it.

Search the project once to be sure nothing else imports Vexo:

```sh
grep -rn "vexo-analytics" src app --include=*.ts --include=*.tsx
```

When it returns nothing, remove the package: `npm uninstall vexo-analytics`.

Later, at your own pace, you can move to the native names (`import Shipstat from 'shipstat'`, `Shipstat.track(...)`); it changes nothing to the data.

## 2. Run both for one release (recommended)

To compare before you switch off Vexo, send each event to both for one release. With a wrapper like most apps have:

```ts
import { customEvent as vexoEvent } from 'vexo-analytics';
import Shipstat from 'shipstat';

export function trackEvent(name: string, props: Record<string, string | number | boolean | null>) {
  vexoEvent(name, props);
  Shipstat.track(name, props);
}
```

After a week, compare the daily count of a few events in both dashboards. They should match within a few percent: Vexo and Shipstat do not drop the same events when a phone stays offline for days.

## 3. Bring your history

Vexo has an [export API](https://docs.vexo.co/settings/app-settings/export-api). Create a personal access token in Vexo (Settings → API tokens, starts with `vexo_pat_`), find your app id, then:

```sh
npx shipstat-dashboard import vexo --app <app id> --token vexo_pat_... --dry-run   # check first
npx shipstat-dashboard import vexo --app <app id> --token vexo_pat_...             # then import
```

Then `npx shipstat-dashboard` shows the history next to the new events.

- **Only your custom events** are imported by default: they are the ones your code sends, so they line up with what Shipstat records from now on. `--all` also keeps what Vexo captured on its own (screens, taps, network requests…).
- **What is kept**: event name, date, device id, your properties (`metadata`), the screen it happened on (`screen`), app version, OS, OS version, device model and country. Vexo's export has no build number and no locale.
- **Dates**: `--since 2025-01-01` and `--until 2026-01-01` to import a range.
- **Interrupted, or run twice?** Nothing is duplicated: ids are derived from Vexo's event ids. Run the same command again.
- Each imported event carries `imported_from: vexo` in its context, so you can filter or compare.
- **Your own database**: `--out history.ndjson` writes one event per line in the [Shipstat format](../../packages/schema/event-batch.schema.json), ready to load.
- **From a file** (a CSV or JSON you already exported): `npx shipstat-dashboard import vexo --file vexo-export.csv`. Usual column names are recognised; other columns become props.

The token is only sent to `api.vexo.co`. Delete it in Vexo once the import is done.

## Checklist

- [ ] `shipstat` installed, app rebuilt
- [ ] imports moved to `shipstat/vexo`, Vexo key replaced by your endpoint
- [ ] `identifyDevice` called with an id, not an email
- [ ] one release with both SDKs, counts compared
- [ ] history imported with `import vexo`
- [ ] `vexo-analytics` uninstalled, Vexo plan cancelled
