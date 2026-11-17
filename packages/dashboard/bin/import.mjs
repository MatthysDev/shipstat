// Bring your history into Shipstat: PostHog (API or export file) and Vexo (export file).
// Each source event becomes one Shipstat event; ids are stable, so running an import twice
// never duplicates anything.
import fs from 'node:fs';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

// --- Shared helpers --------------------------------------------------------------------------

const isPrimitive = (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v);

/** Nested objects become dotted keys, like the SDK's `shipstat/vexo` layer does. */
export function flatten(input, prefix = '', out = {}, depth = 0) {
  if (!input || typeof input !== 'object') return out;
  for (const [key, value] of Object.entries(input)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (value === undefined) continue;
    if (isPrimitive(value)) out[name] = value;
    else if (Array.isArray(value)) out[name] = value.every(isPrimitive) ? value : JSON.stringify(value);
    else if (depth < 3) flatten(value, name, out, depth + 1);
    else out[name] = JSON.stringify(value);
  }
  return out;
}

/** A UUID derived from the source id: same input, same id, on every run. */
export function stableId(source, sourceId) {
  const h = crypto.createHash('sha256').update(`${source}:${sourceId}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function toIso(ts) {
  if (ts === null || ts === undefined || ts === '') return null;
  const n = typeof ts === 'number' ? ts : /^\d+(\.\d+)?$/.test(String(ts)) ? Number(ts) : NaN;
  // Numbers: seconds or milliseconds since epoch.
  const d = Number.isFinite(n) ? new Date(n < 1e12 ? n * 1000 : n) : new Date(String(ts).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(ts)) ? '' : 'Z'));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function parseJsonField(v) {
  if (v && typeof v === 'object') return v;
  if (typeof v !== 'string' || !v) return {};
  try {
    const o = JSON.parse(v);
    return o && typeof o === 'object' ? o : {};
  } catch {
    return {};
  }
}

const platformOf = (os) => {
  const s = String(os ?? '').toLowerCase();
  return s.includes('ios') || s.includes('iphone') || s.includes('ipad') ? 'ios' : s.includes('android') ? 'android' : null;
};

function context(fields, source) {
  const ctx = { imported_from: source };
  for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null && v !== '') ctx[k] = String(v);
  return ctx;
}

// --- PostHog ---------------------------------------------------------------------------------

// PostHog bookkeeping events: no product meaning once outside PostHog.
const POSTHOG_SKIP = new Set(['$identify', '$set', '$create_alias', '$groupidentify', '$feature_flag_called', '$autocapture', '$rageclick', '$pageleave', '$web_vitals', '$snapshot', '$opt_in', '$exception_list']);
const POSTHOG_RENAME = { $screen: 'screen_viewed', $pageview: 'page_viewed', $exception: 'error', 'Application Opened': 'app_opened', 'Application Backgrounded': 'app_backgrounded', 'Application Installed': 'app_installed', 'Application Updated': 'app_updated' };

/**
 * One PostHog event (from the Query API or an export file) → one Shipstat event, or null when
 * it is PostHog bookkeeping. `all` keeps every event, renamed or not.
 */
export function fromPostHog(row, { all = false } = {}) {
  const event = row.event;
  if (!event || (!all && POSTHOG_SKIP.has(event))) return null;
  const p = parseJsonField(row.properties);
  const ts = toIso(row.timestamp);
  if (!ts) return null;
  const props = {};
  for (const [k, v] of Object.entries(flatten(p))) if (!k.startsWith('$') && !k.startsWith('token')) props[k] = v;
  if (event === '$screen' && p.$screen_name) props.screen = String(p.$screen_name);
  if (event === '$pageview' && p.$current_url) props.url = String(p.$current_url);
  if (event === '$exception') props.message = String(p.$exception_message ?? p.$exception_list?.[0]?.value ?? '').slice(0, 500);
  const distinct = row.distinct_id ? String(row.distinct_id) : null;
  // After identify(), PostHog's distinct_id is your user id; before it, an anonymous id.
  const identified = p.$is_identified === true || p.$is_identified === 'true' || (p.$user_id && String(p.$user_id) === distinct);
  const anon = String(p.$device_id ?? row.person_id ?? p.$anon_distinct_id ?? distinct ?? 'unknown');
  return {
    id: row.uuid ? stableId('posthog', row.uuid) : stableId('posthog', `${event}|${ts}|${distinct}`),
    name: POSTHOG_RENAME[event] ?? event,
    ts,
    anon_id: anon,
    user_id: identified ? distinct : null,
    props,
    context: context(
      {
        app_version: p.$app_version,
        build: p.$app_build,
        platform: platformOf(p.$os_name ?? p.$os),
        os_version: p.$os_version,
        device_model: p.$device_name ?? p.$device_model,
        locale: p.$locale,
      },
      'posthog'
    ),
  };
}

/**
 * Pulls every event of a project through PostHog's Query API, oldest first, in pages.
 * Keyset pagination on (timestamp, uuid): safe on millions of rows, resumable with `since`.
 */
export async function* fetchPostHog({ host, project, key, since, until, events, pageSize = 10000, fetchImpl = fetch, onPage }) {
  const base = host.replace(/\/+$/, '');
  let cursorTs = toIso(since) ?? '1970-01-01T00:00:00.000Z';
  let cursorId = '00000000-0000-0000-0000-000000000000';
  const end = toIso(until);
  const filter = events?.length ? ` AND event IN (${events.map((e) => `'${e.replace(/'/g, "\\'")}'`).join(', ')})` : '';
  for (;;) {
    const query = `SELECT uuid, event, timestamp, distinct_id, person_id, properties FROM events
      WHERE (timestamp > toDateTime64('${cursorTs.replace('Z', '')}', 6, 'UTC') OR (timestamp = toDateTime64('${cursorTs.replace('Z', '')}', 6, 'UTC') AND toString(uuid) > '${cursorId}'))
      ${end ? `AND timestamp < toDateTime64('${end.replace('Z', '')}', 6, 'UTC')` : ''}${filter}
      ORDER BY timestamp ASC, toString(uuid) ASC LIMIT ${pageSize}`;
    const res = await retry(() =>
      fetchImpl(`${base}/api/projects/${encodeURIComponent(project)}/query/`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: { kind: 'HogQLQuery', query }, name: 'shipstat-import' }),
      })
    );
    const body = await res.json();
    const cols = body.columns ?? ['uuid', 'event', 'timestamp', 'distinct_id', 'person_id', 'properties'];
    const rows = (body.results ?? []).map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i]])));
    if (!rows.length) return;
    onPage?.(rows.length, rows[rows.length - 1].timestamp);
    for (const row of rows) yield row;
    const last = rows[rows.length - 1];
    cursorTs = toIso(last.timestamp);
    cursorId = String(last.uuid);
    if (rows.length < pageSize) return;
  }
}

/**
 * PostHog's recommended way to export raw events: one file-download export per week of data
 * (JSON Lines, gzip), polled until ready, then downloaded. Needs the batch_export:read and
 * batch_export:write scopes. PostHog bills exported rows past its free allowance.
 */
export async function* exportPostHog({ host, project, key, since, until, events, fetchImpl = fetch, onWindow, pollMs = 5000 }) {
  const base = `${host.replace(/\/+$/, '')}/api/projects/${encodeURIComponent(project)}/file_download_batch_exports`;
  const auth = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const WEEK = 7 * 24 * 3600 * 1000;
  // Stop an hour before now so late events are not missed: run again later to pick them up.
  const end = new Date(toIso(until) ?? Date.now() - 3600 * 1000).getTime();
  let start = new Date(toIso(since) ?? (await firstEventDate({ host, project, key, fetchImpl })) ?? end - 365 * 24 * 3600 * 1000).getTime();
  while (start < end) {
    const stop = Math.min(start + WEEK, end);
    onWindow?.(new Date(start).toISOString(), new Date(stop).toISOString());
    const body = { model: 'events', data_interval_start: new Date(start).toISOString(), data_interval_end: new Date(stop).toISOString(), file: { format: 'JSONLines', compression: 'gzip', max_size_mb: 500 } };
    if (events?.length) body.include_events = events;
    const run = await (await retry(() => fetchImpl(`${base}/`, { method: 'POST', headers: auth, body: JSON.stringify(body) }))).json();
    let state = run;
    while (!['Completed', 'Failed', 'Cancelled', 'FailedRetryable', 'Terminated'].includes(state.status)) {
      await new Promise((r) => setTimeout(r, pollMs));
      state = await (await retry(() => fetchImpl(`${base}/${run.id}/`, { headers: auth }))).json();
    }
    if (state.status !== 'Completed') throw new Error(`PostHog export ${run.id} ended as ${state.status}${state.latest_error ? `: ${state.latest_error}` : ''}`);
    for (const file of state.files ?? []) {
      const fileId = typeof file === 'string' ? file : file.id;
      // The download answers with a redirect to a signed URL: follow it without the API key.
      const first = await retry(() => fetchImpl(`${base}/${run.id}/download/${fileId}/`, { headers: auth, redirect: 'manual' }), 6, true);
      const res = first.status >= 300 && first.status < 400 ? await retry(() => fetchImpl(first.headers.get('location'))) : first;
      const buf = Buffer.from(await res.arrayBuffer());
      const text = (buf[0] === 0x1f && buf[1] === 0x8b ? zlib.gunzipSync(buf) : buf).toString('utf8');
      for (const line of text.split('\n')) if (line.trim()) yield JSON.parse(line);
    }
    start = stop;
  }
}

async function firstEventDate({ host, project, key, fetchImpl }) {
  try {
    const res = await fetchImpl(`${host.replace(/\/+$/, '')}/api/projects/${encodeURIComponent(project)}/query/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: { kind: 'HogQLQuery', query: 'SELECT min(timestamp) FROM events' } }),
    });
    if (!res.ok) return null;
    return toIso((await res.json()).results?.[0]?.[0]);
  } catch {
    return null;
  }
}

async function retry(call, attempts = 6, allowRedirect = false) {
  for (let i = 0; ; i++) {
    const res = await call();
    if (res.ok || (allowRedirect && res.status >= 300 && res.status < 400)) return res;
    const text = await res.text().catch(() => '');
    // 429 and 5xx: wait and try again. Anything else is a real error (bad key, project, query).
    if ((res.status !== 429 && res.status < 500) || i >= attempts - 1) {
      throw new Error(`${res.url ? new URL(res.url).hostname : 'The server'} answered ${res.status}: ${text.slice(0, 300)}`);
    }
    const wait = Number(res.headers.get('retry-after')) * 1000 || Math.min(60000, 2000 * 2 ** i);
    await new Promise((r) => setTimeout(r, wait));
  }
}

// --- Vexo ------------------------------------------------------------------------------------

/**
 * One row of a Vexo export → one Shipstat event. Column names vary between exports, so the
 * usual spellings are accepted; unknown columns become props.
 */
const norm = (k) => k.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().replace(/[\s-]+/g, '_');

export function fromVexo(row, { all = false } = {}) {
  const get = (...names) => {
    for (const n of names) {
      const hit = Object.keys(row).find((k) => norm(k) === n);
      if (hit && row[hit] !== '' && row[hit] !== null && row[hit] !== undefined) return row[hit];
    }
    return undefined;
  };
  // The export API returns every captured event (screens, taps, network...); `type` says which.
  const type = get('type');
  if (type && String(type).toLowerCase() !== 'custom' && !all) return null;
  const name = get('event_name', 'name', 'event', 'custom_event') ?? type;
  const ts = toIso(get('client_creation_date', 'timestamp', 'time', 'date', 'created_at', 'event_time', 'server_received_date'));
  if (!name || !ts) return null;
  const known = new Set(['event_name', 'name', 'event', 'custom_event', 'type', 'timestamp', 'time', 'date', 'created_at', 'event_time', 'client_creation_date', 'server_received_date', 'client_creation_date_readable', 'server_received_date_readable', 'device_id', 'device', 'session_id', 'user_id', 'identifier', 'identified_as', 'app_version', 'version', 'os', 'platform', 'device_system_name', 'os_version', 'device_system_version', 'device_model', 'model', 'locale', 'properties', 'args', 'params', 'metadata', 'id', 'event_id', 'country', 'city', 'route']);
  const props = flatten(parseJsonField(get('metadata', 'properties', 'args', 'params')));
  const route = get('route');
  if (route && route !== 'unknown' && props.screen === undefined) props.screen = String(route);
  for (const [k, v] of Object.entries(row)) {
    const key = norm(k);
    if (!known.has(key) && !key.endsWith('_readable') && v !== '' && v !== undefined && v !== null) props[key] = isPrimitive(v) ? v : JSON.stringify(v);
  }
  const device = get('device_id', 'device', 'session_id');
  const user = get('user_id', 'identifier', 'identified_as');
  const sourceId = get('id', 'event_id') ?? `${name}|${ts}|${device ?? ''}|${JSON.stringify(props)}`;
  return {
    id: stableId('vexo', sourceId),
    name: String(name),
    ts,
    anon_id: String(device ?? user ?? 'unknown'),
    user_id: user ? String(user) : null,
    props,
    context: context(
      {
        app_version: get('app_version', 'version'),
        platform: platformOf(get('device_system_name', 'os', 'platform')),
        os_version: get('device_system_version', 'os_version'),
        country: get('country'),
        device_model: get('device_model', 'model'),
        locale: get('locale'),
      },
      'vexo'
    ),
  };
}

/**
 * Every event of a Vexo app through its export API, one page of up to 10 000 at a time.
 * Authenticate with a personal access token (vexo_pat_..., Vexo settings → API tokens).
 */
export async function* fetchVexo({ app, token, since, until, fetchImpl = fetch, onPage }) {
  const from = new Date(toIso(since) ?? '2020-01-01T00:00:00Z').getTime();
  const to = new Date(toIso(until) ?? Date.now()).getTime();
  for (let page = 1; ; page++) {
    const url = `https://api.vexo.co/external/apps/${encodeURIComponent(app)}/events?from=${from}&to=${to}&itemsPerPage=10000&page=${page}`;
    const body = await (await retry(() => fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } }))).json();
    const data = body.data ?? body;
    const items = data.items ?? [];
    onPage?.(page, items.length, data.totalItems);
    for (const item of items) yield item;
    if (!items.length || page * (data.itemsPerPage ?? 10000) >= (data.totalItems ?? 0)) return;
  }
}

// --- Files -----------------------------------------------------------------------------------

/** Rows of a .csv, .json (array or { results }) or .ndjson/.jsonl file. */
export function* readRows(file) {
  const text = fs.readFileSync(file, 'utf8');
  const ext = file.toLowerCase().split('.').pop();
  if (ext === 'csv') {
    const rows = parseCsv(text);
    const header = rows.shift() ?? [];
    for (const r of rows) if (r.length > 1 || r[0]) yield Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? '']));
  } else if (ext === 'json') {
    const data = JSON.parse(text);
    const list = Array.isArray(data) ? data : (data.results ?? data.events ?? data.data ?? []);
    const cols = data.columns;
    for (const r of list) yield Array.isArray(r) && cols ? Object.fromEntries(cols.map((c, i) => [c, r[i]])) : r;
  } else {
    for (const line of text.split('\n')) if (line.trim()) yield JSON.parse(line);
  }
}

/** RFC 4180: quoted fields, doubled quotes, newlines inside quotes. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') row.push(field), (field = '');
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field), rows.push(row), (row = []), (field = '');
    } else field += c;
  }
  if (field || row.length) row.push(field), rows.push(row);
  return rows;
}
