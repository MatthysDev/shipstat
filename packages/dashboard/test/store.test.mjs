import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { IdWindow, openStore } from '../bin/store.mjs';

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../bin/shipstat-dashboard.mjs');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'shipstat-store-'));
const ev = (i, extra = {}) => ({ id: `e${i}`, name: 'opened', ts: `2026-11-17T10:00:${String(i % 60).padStart(2, '0')}Z`, anon_id: 'a1', user_id: null, props: { i }, context: { platform: 'ios' }, ...extra });
const read = async (store, since = 0, limit = 5000) => {
  const p = await store.page(since, limit);
  return { ...JSON.parse(p.body), cursor: p.cursor };
};
const readAll = async (store) => {
  const out = [];
  let since = 0;
  for (;;) {
    const page = await read(store, since, 2);
    out.push(...page.events);
    if (!page.next_cursor) return out;
    since = Number(page.next_cursor);
  }
};

const open = [];
const make = (dir, opts) => {
  const s = openStore(dir, opts);
  open.push(s);
  return s;
};
afterEach(() => {
  for (const s of open.splice(0)) s.close();
});

describe('store', () => {
  it('pages through hot events with a cursor', async () => {
    const store = make(tmp());
    expect(store.append([ev(0), ev(1), ev(2)])).toBe(3);
    const a = await read(store, 0, 2);
    expect(a.events.map((e) => e.id)).toEqual(['e0', 'e1']);
    expect(a.next_cursor).toBe('2');
    const b = await read(store, 2, 2);
    expect(b.events.map((e) => e.id)).toEqual(['e2']);
    expect(b.next_cursor).toBeNull();
    expect(b.cursor).toBe(3);
    expect(b.events[0].received_at).toMatch(/^\d{4}-/);
  });

  it('drops invalid events and ids it has already seen', () => {
    const store = make(tmp());
    expect(store.append([ev(0), ev(0), { id: 1, name: 'x' }, null, { id: 'n' }])).toBe(1);
    expect(store.append([ev(0), ev(1)])).toBe(1);
    expect(store.total).toBe(2);
  });

  it('compacts into blocks and reads across them in order', async () => {
    const dir = tmp();
    const store = make(dir, { blockSize: 3 });
    store.append([0, 1, 2, 3, 4, 5, 6].map((i) => ev(i)));
    await store.idle();
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.br'))).toHaveLength(1);
    expect(fs.readFileSync(path.join(dir, 'index.ndjson'), 'utf8').trim().split('\n')).toHaveLength(2);
    expect((await readAll(store)).map((e) => e.id)).toEqual(['e0', 'e1', 'e2', 'e3', 'e4', 'e5', 'e6']);
    const all = [];
    for await (const line of store.lines()) all.push(JSON.parse(line).id);
    expect(all).toEqual(['e0', 'e1', 'e2', 'e3', 'e4', 'e5', 'e6']);
  });

  it('keeps everything, and the ids it saw, after a restart', async () => {
    const dir = tmp();
    const first = make(dir, { blockSize: 4 });
    first.append([0, 1, 2, 3, 4, 5].map((i) => ev(i)));
    await first.idle();
    first.close();
    const again = make(dir, { blockSize: 4 });
    expect(again.total).toBe(6);
    expect(again.append([ev(5), ev(6)])).toBe(1);
    expect((await readAll(again)).map((e) => e.id)).toEqual(['e0', 'e1', 'e2', 'e3', 'e4', 'e5', 'e6']);
  });

  it('repairs what a hard kill leaves behind', async () => {
    const dir = tmp();
    const store = make(dir, { blockSize: 2 });
    store.append([0, 1, 2].map((i) => ev(i)));
    await store.idle();
    store.close();
    const segment = fs.readdirSync(dir).find((f) => f.endsWith('.br'));
    // Bytes of a block that never made it to the index, a compacted hot file not yet removed,
    // and a line cut in the middle.
    fs.appendFileSync(path.join(dir, segment), Buffer.from('garbage'));
    fs.writeFileSync(path.join(dir, 'hot-0.ndjson'), JSON.stringify(ev(0)) + '\n');
    fs.appendFileSync(path.join(dir, 'hot-2.ndjson'), '{"id":"e9","na');
    const again = make(dir, { blockSize: 2 });
    expect(again.total).toBe(3);
    expect((await readAll(again)).map((e) => e.id)).toEqual(['e0', 'e1', 'e2']);
    expect(fs.existsSync(path.join(dir, 'hot-0.ndjson'))).toBe(false);
    expect(again.append([ev(3)])).toBe(1);
    expect((await readAll(again)).map((e) => e.id)).toEqual(['e0', 'e1', 'e2', 'e3']);
  });

  it('recovers from a kill during the first compaction of a big batch', async () => {
    const dir = tmp();
    // What append() leaves on disk when killed mid-compaction: the whole batch in hot-0, its
    // remainder already copied to hot-10000, no block indexed yet.
    const lines = Array.from({ length: 150_000 }, (_, i) => JSON.stringify(ev(i)));
    fs.writeFileSync(path.join(dir, 'hot-0.ndjson'), lines.join('\n') + '\n');
    fs.writeFileSync(path.join(dir, 'hot-10000.ndjson'), lines.slice(10_000).join('\n') + '\n');
    const store = make(dir);
    expect(store.total).toBe(150_000);
    await store.idle();
    const first = await read(store, 0, 3);
    expect(first.events.map((e) => e.id)).toEqual(['e0', 'e1', 'e2']);
    const last = await read(store, 149_999, 5);
    expect(last.events.map((e) => e.id)).toEqual(['e149999']);
  });

  it('removes days past the retention, cursors keep working', async () => {
    const dir = tmp();
    const store = make(dir, { blockSize: 2 });
    store.append([0, 1].map((i) => ev(i)));
    await store.idle();
    store.close();
    // Pretend that block was written long ago.
    const segment = fs.readdirSync(dir).find((f) => f.endsWith('.br'));
    fs.renameSync(path.join(dir, segment), path.join(dir, '2020-01-01.br'));
    const index = path.join(dir, 'index.ndjson');
    fs.writeFileSync(index, fs.readFileSync(index, 'utf8').replace(segment, '2020-01-01.br'));
    const again = make(dir, { blockSize: 2, retentionDays: 30 });
    again.append([2, 3].map((i) => ev(i)));
    await again.idle();
    expect(fs.existsSync(path.join(dir, '2020-01-01.br'))).toBe(false);
    expect(again.total).toBe(4);
    expect(again.size).toBe(2);
    expect((await read(again, 0)).events.map((e) => e.id)).toEqual(['e2', 'e3']);
  });

  it('refuses a folder another live process writes to', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'LOCK'), String(process.ppid));
    expect(() => openStore(dir)).toThrow(/in use/);
    fs.writeFileSync(path.join(dir, 'LOCK'), '999999');
    expect(() => make(dir)).not.toThrow();
  });

  it('stores realistic events in well under 100 bytes each', async () => {
    const dir = tmp();
    const store = make(dir);
    const users = Array.from({ length: 300 }, (_, u) => ({ anon: crypto.randomUUID(), ctx: { app_version: ['2.3.0', '2.4.0'][u % 2], build: '240', platform: u % 3 ? 'ios' : 'android', os_version: '27.0', device_model: 'iPhone17,1', locale: 'fr-FR', sdk_version: '0.2.0' } }));
    const batch = Array.from({ length: 10_000 }, (_, i) => {
      const u = users[i % users.length];
      return { id: crypto.randomUUID(), name: ['screen_viewed', 'set_logged', 'app_opened'][i % 3], ts: new Date(Date.UTC(2026, 10, 1) + i * 1700).toISOString(), anon_id: u.anon, user_id: null, props: { screen: ['home', 'plan', 'coach'][i % 3], reps: i % 12 }, context: u.ctx };
    });
    store.append(batch);
    await store.idle();
    expect(store.bytes / 10_000).toBeLessThan(100);
  });
});

describe('id window', () => {
  it('forgets the oldest generation only', () => {
    const w = new IdWindow(2);
    for (const id of ['a', 'b', 'c']) w.add(id);
    expect(w.has('a') && w.has('b') && w.has('c')).toBe(true);
    for (const id of ['d', 'e']) w.add(id);
    expect(w.has('a')).toBe(false);
    expect(w.has('e')).toBe(true);
  });
});

describe('import into a folder', () => {
  it('adds new events only, run after run', async () => {
    const dir = tmp();
    const csv = path.join(dir, 'events.csv');
    fs.writeFileSync(csv, 'uuid,event,timestamp,distinct_id,properties\nu1,signup,2026-01-01T10:00:00Z,d1,{}\nu2,paid,2026-01-01T11:00:00Z,d1,{}\n');
    const data = path.join(dir, 'shipstat-data');
    execFileSync('node', [CLI, 'import', 'posthog', '--file', csv, '--data', data]);
    const out = execFileSync('node', [CLI, 'import', 'posthog', '--file', csv, '--data', data]).toString();
    expect(out).toContain('2 already there');
    const store = make(data);
    expect((await readAll(store)).map((e) => e.name)).toEqual(['signup', 'paid']);
  });
});

async function serve(args) {
  const port = 18000 + Math.floor(Math.random() * 1000);
  const child = spawn('node', [CLI, '--port', String(port), ...args], { stdio: 'pipe' });
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 100));
    if (await fetch(`http://localhost:${port}/health`).then(() => true, () => false)) break;
  }
  return { url: `http://localhost:${port}`, stop: () => new Promise((r) => (child.kill(), child.once('exit', r))) };
}

describe('server', () => {
  it('keeps writing and reading behind separate keys, and never gives a key out', async () => {
    const s = await serve(['--data', path.join(tmp(), 'd'), '--token', 'w-key', '--read-token', 'r-key']);
    try {
      const post = (auth) => fetch(`${s.url}/events`, { method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) }, body: JSON.stringify({ events: [ev(1)] }) });
      const get = (auth) => fetch(`${s.url}/events/export`, { headers: auth ? { authorization: auth } : {} });
      expect((await post()).status).toBe(401);
      expect((await post('Bearer w-key')).status).toBe(200);
      expect((await get('Bearer w-key')).status).toBe(401);
      expect((await get('Bearer r-key')).status).toBe(200);
      const config = await (await fetch(`${s.url}/shipstat.config.json`)).text();
      expect(config).not.toContain('w-key');
      expect(config).not.toContain('r-key');
      expect(JSON.parse(config).needsKey).toBe(true);
      expect((await fetch(`${s.url}/bench`, { method: 'POST', body: '{}' })).status).toBe(401);
    } finally {
      await s.stop();
    }
  });

  it('refuses oversized bodies', async () => {
    const s = await serve(['--data', path.join(tmp(), 'd')]);
    try {
      const huge = JSON.stringify({ events: [{ id: 'x', name: 'y', pad: 'z'.repeat(6 << 20) }] });
      const status = await fetch(`${s.url}/events`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: huge }).then((r) => r.status, () => 413);
      expect(status).toBe(413);
    } finally {
      await s.stop();
    }
  });

  it('moves an old NDJSON file into a folder and serves it', async () => {
    const dir = tmp();
    const legacy = path.join(dir, 'events.ndjson');
    fs.writeFileSync(legacy, [ev(0, { received_at: '2026-01-01T00:00:00.000Z' }), ev(1)].map((e) => JSON.stringify(e)).join('\n') + '\n');
    const port = 18000 + Math.floor(Math.random() * 1000);
    const child = spawn('node', [CLI, '--port', String(port), '--data', legacy], { stdio: 'pipe' });
    try {
      let body;
      for (let i = 0; i < 50 && !body; i++) {
        await new Promise((r) => setTimeout(r, 100));
        body = await fetch(`http://localhost:${port}/events/export`).then((r) => r.json(), () => undefined);
      }
      expect(body.events.map((e) => e.id)).toEqual(['e0', 'e1']);
      expect(body.events[0].received_at).toBe('2026-01-01T00:00:00.000Z');
      expect(fs.statSync(path.join(dir, 'events')).isDirectory()).toBe(true);
    } finally {
      child.kill();
    }
    await new Promise((r) => child.once('exit', r));
    const dumped = execFileSync('node', [CLI, 'dump', '--data', path.join(dir, 'events')]).toString().trim().split('\n');
    expect(dumped.map((l) => JSON.parse(l).id)).toEqual(['e0', 'e1']);
  });
});
