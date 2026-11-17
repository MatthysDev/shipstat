#!/usr/bin/env node
// Shipstat local stack in one command: receives events from your app, stores them in an
// NDJSON file, serves them back, and serves the dashboard already connected in live mode.
//
//   npx shipstat-dashboard [--port 8787] [--token secret] [--data ./shipstat-events.ndjson] [--demo]
//   npx shipstat-dashboard import <posthog|vexo> ...   (see --help)
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { demoEvents, demoWorkspace } from './demo.mjs';

const args = process.argv.slice(2);
if (args[0] === 'import') {
  const { runImport } = await import('./import-cli.mjs');
  process.exit(await runImport(args.slice(1)));
}
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: npx shipstat-dashboard [--port 8787] [--token <secret>] [--data <file.ndjson>] [--demo]\n\n  --demo   start with 45 days of sample events when the data file is empty\n  --workspace <file.json>   share boards, event catalog and branding with everyone who opens the dashboard\n\nImport your history:  npx shipstat-dashboard import --help');
  process.exit(0);
}

const PORT = Number(opt('--port', process.env.PORT ?? 8787));
const TOKEN = opt('--token', process.env.SHIPSTAT_TOKEN ?? '');
const DATA = path.resolve(opt('--data', process.env.SHIPSTAT_DATA ?? 'shipstat-events.ndjson'));
const WORKSPACE = opt('--workspace', process.env.SHIPSTAT_WORKSPACE ?? '');
const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');

// --- Storage: an append-only NDJSON file, loaded in memory at start --------------------

const events = [];
const seen = new Set();
if (fs.existsSync(DATA)) {
  for (const line of fs.readFileSync(DATA, 'utf8').split('\n')) {
    if (!line) continue;
    try {
      const e = JSON.parse(line);
      events.push(e);
      seen.add(e.id);
    } catch {
      // A line cut by a hard kill: skip it rather than refuse to start.
    }
  }
}

if (args.includes('--demo') && events.length === 0) {
  // Seed sample events up to now; real events from your app are added on top.
  append(demoEvents());
}

function append(batch) {
  const now = new Date().toISOString();
  let added = 0;
  let out = '';
  for (const e of batch) {
    if (!e || typeof e.id !== 'string' || typeof e.name !== 'string' || seen.has(e.id)) continue;
    const row = { ...e, received_at: now };
    seen.add(e.id);
    events.push(row);
    out += JSON.stringify(row) + '\n';
    added++;
  }
  if (out) fs.appendFileSync(DATA, out);
  return added;
}

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

// Bodies may be gzipped (`init({ compress: true })` in the app).
const readBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks);
        resolve((req.headers['content-encoding'] === 'gzip' ? zlib.gunzipSync(raw) : raw).toString('utf8'));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });

function serveStatic(res, pathname) {
  const file = path.join(DIST, path.normalize(pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return false;
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': pathname === '/' ? 'no-cache' : 'public, max-age=3600' });
  fs.createReadStream(file).pipe(res);
  return true;
}

const authorized = (req) => !TOKEN || req.headers.authorization === `Bearer ${TOKEN}`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'OPTIONS') return json(res, 204);

  if (url.pathname === '/events' && req.method === 'POST') {
    if (!authorized(req)) return json(res, 401, { error: 'unauthorized' });
    let batch;
    try {
      batch = JSON.parse(await readBody(req));
    } catch {
      // Invalid JSON or a corrupt gzip body.
      return json(res, 400, { error: 'invalid json' });
    }
    if (!Array.isArray(batch?.events)) return json(res, 400, { error: 'expected { events: [...] }' });
    const added = append(batch.events);
    log(`+${added} event${added === 1 ? '' : 's'} · ${events.length} stored`);
    return json(res, 200, { accepted: added });
  }

  if (url.pathname === '/events/export' && req.method === 'GET') {
    if (!authorized(req)) return json(res, 401, { error: 'unauthorized' });
    const since = Math.max(0, Number(url.searchParams.get('since')) || 0);
    const limit = Math.min(Math.max(1, Number(url.searchParams.get('limit')) || 5000), 50000);
    const page = events.slice(since, since + limit);
    const next = since + page.length;
    return json(res, 200, { events: page, next_cursor: next < events.length ? String(next) : null, cursor: String(next) });
  }

  // Lets a dashboard served from here connect to its own server without any setup.
  // With --workspace, the file is read on every request so edits show on reload.
  if (url.pathname === '/shipstat.config.json') {
    return json(res, 200, { source: { url: '/events/export', headerName: TOKEN ? 'Authorization' : '', headerValue: TOKEN ? `Bearer ${TOKEN}` : '' }, live: true, name: 'Local', workspace: sharedWorkspace() });
  }

  // Reports from the example app's Perf lab.
  if (url.pathname === '/bench' && req.method === 'POST') {
    fs.appendFileSync(path.join(path.dirname(DATA), 'bench-results.ndjson'), (await readBody(req)).replace(/\n/g, ' ') + '\n');
    log('benchmark report saved');
    return json(res, 200, { ok: true });
  }

  if (url.pathname === '/health') return json(res, 200, { ok: true, events: events.length });

  if (req.method === 'GET' && serveStatic(res, url.pathname)) return;
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

function log(msg) {
  console.log(`\x1b[2m${new Date().toLocaleTimeString()}\x1b[0m ${msg}`);
}

server.listen(PORT, () => {
  const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
  const dim = (s) => `\x1b[2m${s}\x1b[0m`;
  const bold = (s) => `\x1b[1m${s}\x1b[0m`;
  console.log(`
  ${bold('Shipstat')}  ${dim(`${events.length} events in ${shortPath(DATA)}`)}

  Dashboard        ${bold(`http://localhost:${PORT}`)}
  Endpoint         ${dim('simulator')}  http://localhost:${PORT}/events
                   ${dim('emulator ')}  http://10.0.2.2:${PORT}/events${lan ? `\n                   ${dim('device   ')}  http://${lan}:${PORT}/events` : ''}
${TOKEN ? `  Auth             Authorization: Bearer ${TOKEN}\n` : ''}${WORKSPACE ? `  Workspace        ${shortPath(path.resolve(WORKSPACE))}\n` : ''}${fs.existsSync(DIST) ? '' : dim('\n  Dashboard not built: run `pnpm --filter shipstat-dashboard build`.\n')}`);
});
