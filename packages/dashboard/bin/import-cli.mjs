// `npx shipstat-dashboard import ...`: brings PostHog or Vexo history into a Shipstat data folder.
import fs from 'node:fs';
import path from 'node:path';
import { exportPostHog, fetchPostHog, fetchVexo, fromPostHog, fromVexo, readRows } from './import.mjs';
import { hashId, openStore } from './store.mjs';

const HELP = `Import your history into Shipstat. Running it twice never duplicates events.

  From PostHog, straight from its API:
    npx shipstat-dashboard import posthog --host https://eu.posthog.com --project <id> --key <phx_...>
      --via export            PostHog's file exports, one per week (default). Key scopes:
                              batch_export:read + batch_export:write. PostHog bills exported
                              rows past its free allowance.
      --via query             the Query API instead (scope query:read): free, slower, and
                              PostHog may rate-limit it
      --all                   keep PostHog bookkeeping events ($identify, $feature_flag_called, ...)

  From Vexo, straight from its export API:
    npx shipstat-dashboard import vexo --app <app id> --token <vexo_pat_...>
      --all                   keep every captured event (screens, taps, network...), not only
                              your custom events

  Both:
      --since 2025-01-01      start date (default: everything)
      --until 2026-11-01      end date, exclusive (default: now)
      --events a,b,c          only these event names (PostHog)

  From an export file (PostHog or Vexo, .csv / .json / .ndjson):
    npx shipstat-dashboard import posthog --file events.csv
    npx shipstat-dashboard import vexo --file vexo-export.csv

  Where the events go:
    --data <folder>           the folder \`npx shipstat-dashboard\` reads (default: shipstat-data).
                              Stop the server first: one process writes to a folder at a time.
    --out <file.ndjson>       write a plain NDJSON file instead, to load into your own database
    --dry-run                 read and convert, write nothing, print a summary

  Keys: PostHog personal API key (Settings → Personal API keys), Vexo personal access token
  (Settings → API tokens). They are only sent to PostHog or Vexo.
`;

export async function runImport(argv) {
  const opt = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const source = argv[0];
  if (!source || argv.includes('--help') || argv.includes('-h') || !['posthog', 'vexo'].includes(source)) {
    console.log(HELP);
    return source && !['posthog', 'vexo', '--help', '-h'].includes(source) ? 1 : 0;
  }

  const dry = argv.includes('--dry-run');
  const outFile = path.resolve(opt('--out') ?? opt('--data') ?? process.env.SHIPSTAT_DATA ?? 'shipstat-data');
  // A .ndjson path is a plain file (for your own database); anything else is a server folder.
  const plain = /\.(nd)?jsonl?$/i.test(outFile) || (fs.existsSync(outFile) && fs.statSync(outFile).isFile());
  // Hashes of every id already there, so a second run adds nothing (8 bytes each, not a string).
  const seen = new Set();
  let store = null;
  if (!dry && plain && fs.existsSync(outFile)) {
    for (const line of fs.readFileSync(outFile, 'utf8').split('\n')) {
      if (!line) continue;
      try {
        seen.add(hashId(JSON.parse(line).id));
      } catch {
        // Partial last line: ignored, like the server does.
      }
    }
  } else if (!dry && !plain) {
    try {
      store = openStore(outFile);
    } catch (e) {
      return fail(e.message);
    }
    for await (const line of store.lines()) {
      try {
        seen.add(hashId(JSON.parse(line).id));
      } catch {
        // Not an event line.
      }
    }
  }

  let rows;
  const file = opt('--file');
  if (file) {
    if (!fs.existsSync(file)) return fail(`File not found: ${file}`);
    rows = readRows(file);
  } else if (source === 'posthog') {
    const host = opt('--host') ?? 'https://eu.posthog.com';
    const project = opt('--project');
    const key = opt('--key') ?? process.env.POSTHOG_PERSONAL_API_KEY;
    if (!project || !key) return fail('PostHog needs --project <id> and --key <personal API key> (or POSTHOG_PERSONAL_API_KEY).');
    const common = { host, project, key, since: opt('--since'), until: opt('--until'), events: opt('--events')?.split(',').map((s) => s.trim()).filter(Boolean) };
    rows =
      opt('--via') === 'query'
        ? fetchPostHog({ ...common, onPage: (n, last) => process.stderr.write(`\r  fetched up to ${String(last).slice(0, 19)} (+${n})        `) })
        : exportPostHog({ ...common, onWindow: (a, b) => process.stderr.write(`\r  exporting ${a.slice(0, 10)} → ${b.slice(0, 10)}        `) });
  } else {
    const app = opt('--app');
    const token = opt('--token') ?? process.env.VEXO_API_TOKEN;
    if (!app || !token) return fail('Vexo needs --app <app id> and --token <personal access token> (or VEXO_API_TOKEN), or --file <export>.');
    rows = fetchVexo({ app, token, since: opt('--since'), until: opt('--until'), onPage: (page, n, total) => process.stderr.write(`\r  page ${page}: +${n} of ${total ?? '?'}        `) });
  }

  const all = argv.includes('--all');
  const map = source === 'posthog' ? (r) => fromPostHog(r, { all }) : (r) => fromVexo(r, { all });
  const counts = new Map();
  let read = 0;
  let added = 0;
  let skipped = 0;
  let dupes = 0;
  let buffer = '';
  let batch = [];
  const flush = () => {
    if (!dry && store && batch.length) store.append(batch);
    else if (!dry && buffer) fs.appendFileSync(outFile, buffer);
    buffer = '';
    batch = [];
  };
  try {
    for await (const row of rows) {
      read++;
      const e = map(row);
      if (!e) {
        skipped++;
        continue;
      }
      const h = hashId(e.id);
      if (seen.has(h)) {
        dupes++;
        continue;
      }
      seen.add(h);
      counts.set(e.name, (counts.get(e.name) ?? 0) + 1);
      if (store) batch.push(e);
      else buffer += JSON.stringify({ ...e, received_at: new Date().toISOString() }) + '\n';
      added++;
      if (buffer.length > 1 << 20 || batch.length >= 10_000) flush();
    }
  } catch (err) {
    flush();
    await store?.idle();
    store?.close();
    process.stderr.write('\n');
    // Everything written so far is kept: run the same command again to resume.
    return fail(`${err.message}\n  ${added} events were saved; run the same command again to continue.`);
  }
  flush();
  await store?.idle();
  store?.close();
  process.stderr.write('\n');

  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  console.log(`
  ${dry ? 'Dry run: nothing written' : `Imported into ${path.relative(process.cwd(), outFile) || outFile}`}
  ${read} read · ${added} ${dry ? 'to import' : 'imported'} · ${dupes} already there · ${skipped} skipped (no name or date, ${source === 'posthog' ? 'or PostHog bookkeeping' : 'or not a custom event'}; --all keeps them)
${top.map(([n, c]) => `    ${String(c).padStart(8)}  ${n}`).join('\n')}${counts.size > top.length ? `\n    … and ${counts.size - top.length} more event names` : ''}
`);
  return 0;
}

function fail(msg) {
  console.error(`\n  ${msg}\n`);
  return 1;
}
