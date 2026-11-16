// Minimal Shipstat backend for local development: ingest + read API, events kept in an NDJSON file.
// node server.mjs [--port 8787] [--token dev-token]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const PORT = Number(opt('--port', process.env.PORT ?? 8787));
const TOKEN = opt('--token', process.env.SHIPSTAT_TOKEN ?? '');
const FILE = path.resolve(opt('--file', 'events.ndjson'));

const events = [];
const seen = new Set();
if (fs.existsSync(FILE)) {
  for (const line of fs.readFileSync(FILE, 'utf8').split('\n')) {
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

/** Reads a whole request body as UTF-8 (chunks are joined as bytes, so characters are never split). */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const send = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...cors });
  res.end(body === undefined ? '' : JSON.stringify(body));
};

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') return send(res, 204);
  if (TOKEN && req.headers.authorization !== `Bearer ${TOKEN}`) return send(res, 401, { error: 'unauthorized' });

  if (req.method === 'POST' && url.pathname === '/events') {
    readBody(req).then((raw) => {
      let batch;
      try { batch = JSON.parse(raw); } catch { return send(res, 400, { error: 'invalid json' }); }
      if (!Array.isArray(batch?.events)) return send(res, 400, { error: 'missing events' });
      const now = new Date().toISOString();
      let added = 0;
      const out = fs.openSync(FILE, 'a');
      for (const e of batch.events) {
        if (!e?.id || seen.has(e.id)) continue;
        const row = { ...e, received_at: now };
        seen.add(e.id);
        events.push(row);
        fs.writeSync(out, JSON.stringify(row) + '\n');
        added++;
      }
      fs.closeSync(out);
      console.log(`${now} +${added} (${batch.events.length} in batch, ${events.length} total)`);
      send(res, 200, { accepted: added });
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/events/export') {
    const since = Number(url.searchParams.get('since') ?? 0) || 0;
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 5000) || 5000, 50000);
    const page = events.slice(since, since + limit);
    const next = since + page.length;
    return send(res, 200, { events: page, next_cursor: next < events.length ? String(next) : null, cursor: String(next) });
  }

  if (req.method === 'POST' && url.pathname === '/bench') {
    readBody(req).then((raw) => {
      fs.appendFileSync(path.resolve(path.dirname(FILE), 'bench-results.ndjson'), raw.replace(/\n/g, ' ') + '\n');
      console.log('benchmark report received');
      send(res, 200, { ok: true });
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true, events: events.length });
  send(res, 404, { error: 'not found' });
}).listen(PORT, () => console.log(`shipstat dev server on http://localhost:${PORT} (${events.length} events in ${FILE})`));
