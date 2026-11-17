#!/usr/bin/env node
// Shipstat in one command: receives events from your app, stores them compressed in a data
// folder, serves them back, and serves the dashboard already connected in live mode.
//
//   npx shipstat-dashboard [--port 8787] [--token secret] [--data ./shipstat-data] [--demo]
//   npx shipstat-dashboard import <posthog|vexo> ...   (see --help)
//   npx shipstat-dashboard migrate vexo [dir]           (rewrites the code, dry run by default)
//   npx shipstat-dashboard dump [--data dir] > events.ndjson
import { timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import zlib from 'node:zlib';
import { demoEvents, demoWorkspace } from './demo.mjs';
import { openStore } from './store.mjs';

const args = process.argv.slice(2);
if (args[0] === 'migrate') {
  const { runMigrate } = await import('./migrate.mjs');
  process.exit(runMigrate(args.slice(1)));
}
if (args[0] === 'import') {
  const { runImport } = await import('./import-cli.mjs');
  process.exit(await runImport(args.slice(1)));
}
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
if (args[0] === 'dump') {
  // Every stored event as NDJSON on stdout, oldest first. Safe while a server is running.
  const store = openStore(path.resolve(opt('--data', process.env.SHIPSTAT_DATA ?? 'shipstat-data')), { readOnly: true });
  for await (const line of store.lines()) if (!process.stdout.write(line + '\n')) await new Promise((r) => process.stdout.once('drain', r));
  process.exit(0);
}
if (args.includes('--help') || args.includes('-h')) {
  console.log(`Usage: npx shipstat-dashboard [options]

  --port <n>                 default 8787
  --token <secret>           required to send events (Authorization: Bearer <secret>)
  --read-token <secret>      required to read them; the dashboard asks for it once.
                             Defaults to --token. Use both: the app's key then cannot read.
  --data <folder>            where events are stored, compressed (default: ./shipstat-data)
  --retention-days <n>       delete events older than n days (default: keep everything)
  --workspace <file.json>    share boards, event catalog and branding with everyone who opens the dashboard
  --demo                     start with 45 days of sample events when the folder is empty

Move from Vexo:       npx shipstat-dashboard migrate vexo --help
Import your history:  npx shipstat-dashboard import --help
Back up everything:   npx shipstat-dashboard dump > events.ndjson`);
  process.exit(0);
}

const PORT = Number(opt('--port', process.env.PORT ?? 8787));
// The write token ships inside the app, so anyone can extract it: give reads their own key.
const TOKEN = opt('--token', process.env.SHIPSTAT_TOKEN ?? '');
const READ_TOKEN = opt('--read-token', process.env.SHIPSTAT_READ_TOKEN ?? '') || TOKEN;
const RETENTION = Math.max(0, Number(opt('--retention-days', process.env.SHIPSTAT_RETENTION_DAYS ?? 0)) || 0);
let DATA = path.resolve(opt('--data', process.env.SHIPSTAT_DATA ?? 'shipstat-data'));
// Before 0.2 events lived in one NDJSON file: move it into a folder once, keep the file.
let legacy = null;
if (fs.existsSync(DATA) && fs.statSync(DATA).isFile()) {
  legacy = DATA;
  DATA = DATA.replace(/\.ndjson$/i, '') === DATA ? `${DATA}-data` : DATA.replace(/\.ndjson$/i, '');
} else if (!opt('--data') && !process.env.SHIPSTAT_DATA && !fs.existsSync(DATA) && fs.existsSync('shipstat-events.ndjson')) {
  legacy = path.resolve('shipstat-events.ndjson');
}
const WORKSPACE = opt('--workspace', process.env.SHIPSTAT_WORKSPACE ?? '');
const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');

// --- Storage: compressed blocks on disk, only the newest events in memory (see store.mjs) ---

let store;
try {
  store = openStore(DATA, { retentionDays: RETENTION, log });
} catch (e) {
  console.error(`\n  ${e.message}\n`);
  process.exit(1);
}

if (legacy && store.total === 0) {
  let batch = [];
  let moved = 0;
  // Line by line: the old file may be larger than the memory this process should use.
  for await (const line of readline.createInterface({ input: fs.createReadStream(legacy), crlfDelay: Infinity })) {
    try {
      if (line) batch.push(JSON.parse(line));
    } catch {
      // A line cut by a hard kill.
    }
    if (batch.length === 10_000) {
      moved += store.append(batch, { receivedAt: 'keep' });
      batch = [];
    }
  }
  moved += store.append(batch, { receivedAt: 'keep' });
  await store.compactNow();
  log(`moved ${moved} events from ${shortPath(legacy)} into ${shortPath(DATA)} (the file is kept, you can delete it)`);
}

if (args.includes('--demo') && store.total === 0) {
  // Seed sample events up to now; real events from your app are added on top.
  store.append(demoEvents());
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(0));

// --- HTTP ---------------------------------------------------------------------------------

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon' };

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...CORS });
  res.end(body === undefined ? '' : JSON.stringify(body));
};

// Bodies are gzipped by default by the app. A batch is ~2 kB gzipped, ~40 kB plain: the limits
// only stop abuse.
const MAX_BODY = 5 << 20;
const MAX_PLAIN = 20 << 20;
const readBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('body too large'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks);
        resolve((req.headers['content-encoding'] === 'gzip' ? zlib.gunzipSync(raw, { maxOutputLength: MAX_PLAIN }) : raw).toString('utf8'));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });

// The dashboard's DuckDB engine is a 36 MB file: 7.1 MB in brotli (HTTPS browsers), 8.1 MB in
// gzip. Compressed on first request (< 1 s), then kept for the life of the process.
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.wasm', '.svg', '.json']);
const compressed = new Map();
const ENCODERS = {
  br: (buf) => promisify(zlib.brotliCompress)(buf, { chunkSize: 1 << 20, params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } }),
  gzip: (buf) => promisify(zlib.gzip)(buf, { level: 6, chunkSize: 1 << 20 }),
};
function encoded(file, encoding) {
  const key = `${encoding}:${file}`;
  let p = compressed.get(key);
  if (!p) {
    p = fs.promises.readFile(file).then(ENCODERS[encoding]);
    p.catch(() => compressed.delete(key));
    compressed.set(key, p);
  }
  return p;
}

async function serveStatic(req, res, pathname) {
  const file = path.join(DIST, path.normalize(pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(DIST + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return false;
  const headers = { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': pathname === '/' || pathname === '/index.html' ? 'no-cache' : 'public, max-age=31536000, immutable', Vary: 'Accept-Encoding' };
  const accepts = req.headers['accept-encoding'] ?? '';
  const encoding = !COMPRESSIBLE.has(path.extname(file)) ? null : /\bbr\b/.test(accepts) ? 'br' : /\bgzip\b/.test(accepts) ? 'gzip' : null;
  if (encoding) {
    const body = await encoded(file, encoding);
    res.writeHead(200, { ...headers, 'Content-Encoding': encoding, 'Content-Length': body.length });
    res.end(body);
  } else {
    res.writeHead(200, headers);
    fs.createReadStream(file).pipe(res);
  }
  return true;
}

function sameSecret(given, expected) {
  const a = Buffer.from(given ?? '');
  const b = Buffer.from(`Bearer ${expected}`);
  return a.length === b.length && timingSafeEqual(a, b);
}
const canWrite = (req) => !TOKEN || sameSecret(req.headers.authorization, TOKEN);
const canRead = (req) => !READ_TOKEN || sameSecret(req.headers.authorization, READ_TOKEN);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'OPTIONS') return json(res, 204);

  if (url.pathname === '/events' && req.method === 'POST') {
    if (!canWrite(req)) return json(res, 401, { error: 'unauthorized' });
    let batch;
    try {
      batch = JSON.parse(await readBody(req));
    } catch (e) {
      // Invalid JSON, a corrupt gzip body, or too large.
      return json(res, e.status ?? 400, { error: e.status ? 'too large' : 'invalid json' });
    }
    if (!Array.isArray(batch?.events)) return json(res, 400, { error: 'expected { events: [...] }' });
    let added;
    try {
      added = store.append(batch.events);
    } catch (e) {
      // Disk full or similar: the app keeps the batch and retries.
      log(`could not store a batch: ${e.message}`);
      return json(res, 503, { error: 'storage unavailable' });
    }
    log(`+${added} event${added === 1 ? '' : 's'} · ${store.size} stored`);
    return json(res, 200, { accepted: added });
  }

  if (url.pathname === '/events/export' && req.method === 'GET') {
    if (!canRead(req)) return json(res, 401, { error: 'unauthorized' });
    const limit = Math.min(Math.max(1, Number(url.searchParams.get('limit')) || 5000), 50000);
    const { body } = await store.page(url.searchParams.get('since'), limit);
    res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
    return res.end(body);
  }

  // Lets a dashboard served from here connect to its own server without any setup.
  // With --workspace, the file is read on every request so edits show on reload.
  if (url.pathname === '/shipstat.config.json') {
    // Never a secret here: anyone can fetch this file. With a read key, the dashboard asks for it.
    return json(res, 200, { source: { url: '/events/export', headerName: READ_TOKEN ? 'Authorization' : '', headerValue: '' }, needsKey: !!READ_TOKEN, live: true, name: 'Local', workspace: sharedWorkspace() });
  }

  // Reports from the example app's Perf lab.
  if (url.pathname === '/bench' && req.method === 'POST') {
    if (!canWrite(req)) return json(res, 401, { error: 'unauthorized' });
    fs.appendFileSync(path.join(path.dirname(DATA), 'bench-results.ndjson'), (await readBody(req)).replace(/\n/g, ' ') + '\n');
    log('benchmark report saved');
    return json(res, 200, { ok: true });
  }

  if (url.pathname === '/health') return json(res, 200, { ok: true, events: store.total, stored: store.size });

  if (req.method === 'GET' && (await serveStatic(req, res, url.pathname))) return;
  json(res, 404, { error: 'not found' });
});

// Boards, event catalog and branding only: never data sources or credentials.
function sharedWorkspace() {
  if (!WORKSPACE) return args.includes('--demo') ? demoWorkspace() : undefined;
  try {
    const ws = JSON.parse(fs.readFileSync(path.resolve(WORKSPACE), 'utf8'));
    // A bare tracking plan (`{ events }` or a list of events) is a catalog-only workspace.
    const plan = Array.isArray(ws) ? ws : ws.events ? { events: ws.events, keys: ws.keys } : undefined;
    return { shipstat: 'workspace', version: 1, branding: ws.branding, catalog: ws.catalog ?? plan, boards: ws.boards };
  } catch (e) {
    log(`workspace ${shortPath(path.resolve(WORKSPACE))} not served: ${e.message}`);
    return undefined;
  }
}

function shortPath(p) {
  const rel = path.relative(process.cwd(), p);
  return rel && !rel.startsWith('..') ? rel : p;
}

function formatBytes(n) {
  return n < 1e6 ? `${Math.round(n / 1e3)} kB` : n < 1e9 ? `${(n / 1e6).toFixed(1)} MB` : `${(n / 1e9).toFixed(2)} GB`;
}

function log(msg) {
  console.log(`\x1b[2m${new Date().toLocaleTimeString()}\x1b[0m ${msg}`);
}

server.listen(PORT, () => {
  const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
  const dim = (s) => `\x1b[2m${s}\x1b[0m`;
  const bold = (s) => `\x1b[1m${s}\x1b[0m`;
  console.log(`
  ${bold('Shipstat')}  ${dim(`${store.size} events in ${shortPath(DATA)}, ${formatBytes(store.bytes)}${RETENTION ? `, kept ${RETENTION} days` : ''}`)}

  Dashboard        ${bold(`http://localhost:${PORT}`)}
  Endpoint         ${dim('simulator')}  http://localhost:${PORT}/events
                   ${dim('emulator ')}  http://10.0.2.2:${PORT}/events${lan ? `\n                   ${dim('device   ')}  http://${lan}:${PORT}/events` : ''}
${TOKEN ? `  Send key         Authorization: Bearer ${TOKEN}  ${dim('(in the app)')}\n` : ''}${READ_TOKEN ? `  Read key         ${READ_TOKEN === TOKEN ? dim('same as the send key: set --read-token so the app key cannot read') : dim('set, the dashboard asks for it once')}\n` : ''}${WORKSPACE ? `  Workspace        ${shortPath(path.resolve(WORKSPACE))}\n` : ''}${fs.existsSync(DIST) ? '' : dim('\n  Dashboard not built: run `pnpm --filter shipstat-dashboard build`.\n')}`);
});
