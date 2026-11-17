// `npx shipstat-dashboard migrate vexo`: rewrites a Vexo integration to Shipstat in place.
// Dry run by default: prints what would change, writes only with --write.
import fs from 'node:fs';
import path from 'node:path';

const HELP = `Move an app from Vexo to Shipstat. Dry run by default.

  npx shipstat-dashboard migrate vexo [dir] [--endpoint <url>] [--write]

    dir                 project folder to scan (default: current folder)
    --endpoint <url>    replaces the Vexo key in vexo('...'), e.g. https://stats.example.com/events
    --write             apply the changes (otherwise only print them)

  What it does:
    - imports and requires of 'vexo-analytics' (and jest mocks) → 'shipstat/vexo'
    - vexo('YOUR_VEXO_KEY') → vexo('<endpoint>'), the code around it is kept
    - flags what needs a human: identifyDevice() called with an email, replay or heatmap
      components that now do nothing, Vexo keys left in config files

  Then: npx expo install shipstat, rebuild the native app, npm uninstall vexo-analytics.
`;

const EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const SKIP = new Set(['node_modules', '.git', 'ios', 'android', 'build', 'dist', '.expo', '.next', 'coverage', 'web-build']);

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP.has(entry.name)) yield* walk(full);
    } else if (EXTS.has(path.extname(entry.name))) yield full;
  }
}

/** Pure transform of one file's source. Returns the new source and notes for the report. */
export function transformVexo(source, { endpoint } = {}) {
  const notes = [];
  let changed = 0;
  let out = source.replace(/((?:from\s*|require\s*\(\s*|import\s*\(\s*|jest\.mock\s*\(\s*|mock\.module\s*\(\s*|import\s+))(['"])vexo-analytics\2/g, (_m, pre, q) => {
    changed++;
    return `${pre}${q}shipstat/vexo${q}`;
  });
  if (!changed) return { source, changed: 0, notes };

  // vexo('KEY', options?) → vexo('<endpoint>', options?)
  out = out.replace(/\bvexo\(\s*(['"`])([^'"`]*)\1/g, (m, q, value) => {
    if (/^https?:\/\//.test(value)) return m;
    if (!endpoint) {
      notes.push({ kind: 'todo', text: `vexo('${value.slice(0, 8)}…') still has the Vexo key: pass --endpoint or set your Shipstat endpoint here` });
      return m;
    }
    changed++;
    return `vexo(${q}${endpoint}${q}`;
  });
  if (/\bvexo\(\s*[A-Za-z_$]/.test(out)) notes.push({ kind: 'todo', text: 'vexo() gets its key from a variable: point that variable to your Shipstat endpoint' });
  if (/identifyDevice\([^)]*email/i.test(out)) notes.push({ kind: 'review', text: 'identifyDevice() is called with an email: Shipstat stores it on every event, prefer an internal user id' });
  if (/\b(VexoMask|VexoUnmask|setHeatmapSegment)\b/.test(out)) notes.push({ kind: 'info', text: 'session replay / heatmap calls are kept but do nothing in Shipstat' });
  if (/\btrackError\(/.test(out)) notes.push({ kind: 'info', text: 'trackError() becomes an `error` event (message only): keep a crash reporter for stack traces' });
  return { source: out, changed, notes };
}

export function runMigrate(argv) {
  const opt = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  if (argv[0] !== 'vexo' || argv.includes('--help') || argv.includes('-h')) {
    console.log(HELP);
    return argv[0] && argv[0] !== 'vexo' && !argv[0].startsWith('-') ? 1 : 0;
  }
  const dir = path.resolve(argv[1] && !argv[1].startsWith('--') ? argv[1] : '.');
  const endpoint = opt('--endpoint');
  const write = argv.includes('--write');
  if (endpoint && !/^https?:\/\//.test(endpoint)) {
    console.error('\n  --endpoint must be a URL, e.g. https://stats.example.com/events\n');
    return 1;
  }

  let files = 0;
  let edits = 0;
  const report = [];
  for (const file of walk(dir)) {
    const before = fs.readFileSync(file, 'utf8');
    if (!before.includes('vexo-analytics')) continue;
    const { source, changed, notes } = transformVexo(before, { endpoint });
    if (!changed && !notes.length) continue;
    files++;
    edits += changed;
    const rel = path.relative(dir, file);
    const lines = [];
    const a = before.split('\n');
    const b = source.split('\n');
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) lines.push(`    ${i + 1}  \x1b[31m- ${a[i]?.trim()}\x1b[0m\n        \x1b[32m+ ${b[i]?.trim()}\x1b[0m`);
    }
    report.push(`  ${rel}\n${lines.join('\n')}${notes.map((n) => `\n    ${n.kind === 'info' ? '·' : '!'} ${n.text}`).join('')}`);
    if (write && source !== before) fs.writeFileSync(file, source);
  }

  // Vexo keys left elsewhere (env files, app config) are worth a look, never edited.
  const leftovers = [];
  for (const name of ['.env', '.env.local', '.env.production', 'app.json', 'app.config.ts', 'app.config.js', 'eas.json']) {
    const f = path.join(dir, name);
    if (fs.existsSync(f) && /vexo/i.test(fs.readFileSync(f, 'utf8'))) leftovers.push(name);
  }
  const pkg = path.join(dir, 'package.json');
  const hasDep = fs.existsSync(pkg) && /"vexo-analytics"/.test(fs.readFileSync(pkg, 'utf8'));

  if (!files) {
    console.log(`\n  No file imports vexo-analytics under ${dir}.\n`);
    return 0;
  }
  console.log(`\n${report.join('\n\n')}\n`);
  console.log(`  ${files} file${files > 1 ? 's' : ''}, ${edits} change${edits > 1 ? 's' : ''} ${write ? 'written' : 'to make (dry run: add --write to apply)'}.`);
  if (leftovers.length) console.log(`  ! Vexo mentioned in ${leftovers.join(', ')}: check by hand.`);
  console.log(`
  Next:
    npx expo install shipstat${hasDep ? '\n    npm uninstall vexo-analytics       (once the app is rebuilt and checked)' : ''}
    rebuild the native app (Shipstat is a native module; an OTA update cannot add it)
`);
  return 0;
}
