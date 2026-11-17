import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import zlib from 'node:zlib';
import { exportPostHog, fetchPostHog, fetchVexo, fromPostHog, fromVexo, parseCsv, readRows, stableId } from '../bin/import.mjs';

const CLI = path.resolve(__dirname, '../bin/shipstat-dashboard.mjs');

const phRow = (over = {}) => ({
  uuid: '0190b6a0-0000-7000-8000-000000000001',
  event: 'session_completed',
  timestamp: '2026-10-01 09:30:00.123000',
  distinct_id: 'user_42',
  person_id: 'person-uuid',
  properties: JSON.stringify({
    session_id: 's1',
    duration_minutes: 32,
    meta: { source: 'push' },
    $app_version: '2.3.0',
    $app_build: '512',
    $os_name: 'iOS',
    $os_version: '26.1',
    $device_name: 'iPhone17,1',
    $locale: 'fr-FR',
    $is_identified: true,
    $device_id: 'device-1',
    $lib: 'posthog-react-native',
  }),
  ...over,
});

describe('PostHog mapping', () => {
  it('keeps the event, its props and the device context', () => {
    const e = fromPostHog(phRow());
    expect(e).toMatchObject({
      name: 'session_completed',
      ts: '2026-10-01T09:30:00.123Z',
      anon_id: 'device-1',
      user_id: 'user_42',
      props: { session_id: 's1', duration_minutes: 32, 'meta.source': 'push' },
      context: { app_version: '2.3.0', build: '512', platform: 'ios', os_version: '26.1', device_model: 'iPhone17,1', locale: 'fr-FR', imported_from: 'posthog' },
    });
    expect(Object.keys(e.props).some((k) => k.startsWith('$'))).toBe(false);
  });

  it('gives the same id on every run', () => {
    expect(fromPostHog(phRow()).id).toBe(fromPostHog(phRow()).id);
    expect(fromPostHog(phRow()).id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('renames screens and errors, drops bookkeeping events', () => {
    expect(fromPostHog(phRow({ event: '$screen', properties: { $screen_name: 'Home' } }))).toMatchObject({ name: 'screen_viewed', props: { screen: 'Home' } });
    expect(fromPostHog(phRow({ event: '$exception', properties: { $exception_message: 'boom' } }))).toMatchObject({ name: 'error', props: { message: 'boom' } });
    expect(fromPostHog(phRow({ event: '$feature_flag_called' }))).toBeNull();
    expect(fromPostHog(phRow({ event: '$feature_flag_called' }), { all: true })).not.toBeNull();
  });

  it('leaves anonymous events without user id', () => {
    expect(fromPostHog(phRow({ distinct_id: 'anon-1', properties: { $device_id: 'anon-1' } })).user_id).toBeNull();
  });
});

describe('PostHog API pagination', () => {
  it('walks pages with a (timestamp, uuid) cursor until a short page', async () => {
    const all = Array.from({ length: 5 }, (_, i) => ['u' + i, 'e', `2026-10-01T00:00:0${i}.000Z`, 'd', 'p', '{}']);
    const queries = [];
    const fetchImpl = async (url, init) => {
      const body = JSON.parse(init.body);
      queries.push(body.query.query);
      expect(url).toBe('https://eu.posthog.com/api/projects/123/query/');
      expect(init.headers.Authorization).toBe('Bearer phx_test');
      const page = queries.length === 1 ? all.slice(0, 2) : queries.length === 2 ? all.slice(2, 4) : all.slice(4);
      return new Response(JSON.stringify({ columns: ['uuid', 'event', 'timestamp', 'distinct_id', 'person_id', 'properties'], results: page }));
    };
    const rows = [];
    for await (const r of fetchPostHog({ host: 'https://eu.posthog.com/', project: '123', key: 'phx_test', pageSize: 2, fetchImpl })) rows.push(r.uuid);
    expect(rows).toEqual(['u0', 'u1', 'u2', 'u3', 'u4']);
    expect(queries[1]).toContain("2026-10-01T00:00:01.000");
    expect(queries[1]).toContain("'u1'");
  });

  it('retries on 429 and stops on a bad key', async () => {
    let calls = 0;
    const flaky = async () => (++calls === 1 ? new Response('slow down', { status: 429, headers: { 'retry-after': '0.001' } }) : new Response(JSON.stringify({ results: [] })));
    for await (const _ of fetchPostHog({ host: 'h', project: '1', key: 'k', fetchImpl: flaky })) void _;
    expect(calls).toBe(2);
    const denied = async () => new Response('{"detail":"invalid key"}', { status: 401 });
    await expect(async () => {
      for await (const _ of fetchPostHog({ host: 'h', project: '1', key: 'k', fetchImpl: denied })) void _;
    }).rejects.toThrow(/401/);
  });
});

describe('PostHog file exports', () => {
  it('exports week by week, polls, follows the signed URL without the key, gunzips', async () => {
    const calls = [];
    const line = JSON.stringify({ uuid: 'x1', event: 'signup', timestamp: '2026-01-02T00:00:00Z', distinct_id: 'd', properties: {} });
    const fetchImpl = async (url, init = {}) => {
      calls.push({ url, auth: init.headers?.Authorization, method: init.method ?? 'GET' });
      if (init.method === 'POST') return new Response(JSON.stringify({ id: 'run' + calls.length, status: 'Running' }), { status: 202 });
      if (url.endsWith('/download/f1/')) return new Response(null, { status: 302, headers: { location: 'https://signed.example/f1' } });
      if (url === 'https://signed.example/f1') return new Response(zlib.gzipSync(line + '\n'));
      return new Response(JSON.stringify({ status: 'Completed', files: [{ id: 'f1' }] }));
    };
    const rows = [];
    for await (const r of exportPostHog({ host: 'https://eu.posthog.com', project: '7', key: 'phx', since: '2026-01-01', until: '2026-01-10', fetchImpl, pollMs: 1 })) rows.push(r);
    expect(rows).toHaveLength(2); // two weekly windows, one file each
    const posts = calls.filter((c) => c.method === 'POST');
    expect(posts).toHaveLength(2);
    expect(posts[0].url).toBe('https://eu.posthog.com/api/projects/7/file_download_batch_exports/');
    expect(calls.find((c) => c.url.startsWith('https://signed.example')).auth).toBeUndefined();
  });

  it('reports a failed export', async () => {
    const fetchImpl = async (url, init = {}) => new Response(JSON.stringify(init.method === 'POST' ? { id: 'r', status: 'Running' } : { status: 'Failed', latest_error: 'quota' }));
    await expect(async () => {
      for await (const _ of exportPostHog({ host: 'h', project: '1', key: 'k', since: '2026-01-01', until: '2026-01-02', fetchImpl, pollMs: 1 })) void _;
    }).rejects.toThrow(/Failed: quota/);
  });
});

describe('Vexo mapping', () => {
  it('maps a row of the export API and keeps only custom events by default', () => {
    const row = { id: 'ev1', name: 'v2_meal_scanned', route: '__root/(tabs)/nutrition', sessionId: 's', deviceId: 'dev-1', type: 'custom', appVersion: '2.3.0', clientCreationDate: 1759311000000, serverReceivedDate: 1759311001000, clientCreationDateReadable: 'x', country: 'FR', city: 'Lille', deviceSystemName: 'iOS', deviceSystemVersion: '26.1', deviceModel: 'iPhone17,1', metadata: { confidence: 'high', ingredients_count: 4, user_id: 'u9' } };
    expect(fromVexo(row)).toMatchObject({
      name: 'v2_meal_scanned',
      ts: '2025-10-01T09:30:00.000Z',
      anon_id: 'dev-1',
      props: { confidence: 'high', ingredients_count: 4, user_id: 'u9', screen: '__root/(tabs)/nutrition' },
      context: { app_version: '2.3.0', platform: 'ios', os_version: '26.1', device_model: 'iPhone17,1', country: 'FR', imported_from: 'vexo' },
    });
    expect(fromVexo({ ...row, type: 'screen' })).toBeNull();
    expect(fromVexo({ ...row, type: 'screen' }, { all: true })).not.toBeNull();
  });

  it('pages through the export API', async () => {
    const urls = [];
    const fetchImpl = async (url, init) => {
      urls.push(url);
      expect(init.headers.Authorization).toBe('Bearer vexo_pat_x');
      const page = Number(new URL(url).searchParams.get('page'));
      return new Response(JSON.stringify({ data: { totalItems: 3, page, itemsPerPage: 2, items: page === 1 ? [{ id: 1 }, { id: 2 }] : [{ id: 3 }] } }));
    };
    const rows = [];
    for await (const r of fetchVexo({ app: 'app1', token: 'vexo_pat_x', since: '2026-01-01', until: '2026-02-01', fetchImpl })) rows.push(r.id);
    expect(rows).toEqual([1, 2, 3]);
    expect(urls[0]).toContain('https://api.vexo.co/external/apps/app1/events?from=1767225600000&to=1769904000000&itemsPerPage=10000&page=1');
  });

  it('accepts the usual column spellings and keeps unknown columns as props', () => {
    const e = fromVexo({ 'Event Name': 'v2_food_logged', Timestamp: '1759311000', 'Device ID': 'dev-9', 'App Version': '2.2.1', OS: 'Android', Properties: '{"items_count":3,"meal":{"name":"Lunch"}}', plan: 'pro' });
    expect(e).toMatchObject({
      name: 'v2_food_logged',
      ts: '2025-10-01T09:30:00.000Z',
      anon_id: 'dev-9',
      user_id: null,
      props: { items_count: 3, 'meal.name': 'Lunch', plan: 'pro' },
      context: { app_version: '2.2.1', platform: 'android', imported_from: 'vexo' },
    });
  });

  it('skips rows without a name or a date', () => {
    expect(fromVexo({ name: 'x' })).toBeNull();
    expect(fromVexo({ timestamp: '2026-01-01' })).toBeNull();
  });
});

describe('files and CLI', () => {
  it('parses quoted CSV with commas, quotes and newlines', () => {
    expect(parseCsv('a,b\n"x, y","say ""hi""\nthere"\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"\nthere']]);
  });

  it('imports a PostHog CSV export twice without duplicates', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipstat-import-'));
    const csv = path.join(dir, 'events.csv');
    const props = JSON.stringify({ $app_version: '1.0', $os: 'iOS', plan: 'pro' }).replace(/"/g, '""');
    fs.writeFileSync(csv, `uuid,event,timestamp,distinct_id,properties\nu1,signup,2026-01-01T10:00:00Z,d1,"${props}"\nu2,$identify,2026-01-01T10:00:01Z,d1,{}\n`);
    const data = path.join(dir, 'data.ndjson');
    execFileSync('node', [CLI, 'import', 'posthog', '--file', csv, '--data', data]);
    const out = execFileSync('node', [CLI, 'import', 'posthog', '--file', csv, '--data', data]).toString();
    const lines = fs.readFileSync(data, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ name: 'signup', props: { plan: 'pro' }, context: { platform: 'ios', app_version: '1.0' } });
    expect(out).toContain('1 already there');
    expect([...readRows(csv)]).toHaveLength(2);
  });

  it('stable ids differ per source', () => {
    expect(stableId('posthog', 'a')).not.toBe(stableId('vexo', 'a'));
  });
});
