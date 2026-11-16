// Builds docs/perf/results.json and docs/perf/latency.svg from the Perf lab reports
// saved by shipstat-dashboard (bench-results.ndjson, next to its data file). Release builds only; every
// number is the median across all runs of a platform.
//
//   node scripts/perf-report.mjs /tmp/bench-results.ndjson
import fs from 'node:fs';
import path from 'node:path';

const input = process.argv[2] ?? 'bench-results.ndjson';
const outDir = path.resolve('docs/perf');
const reports = fs.readFileSync(input, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Median of every numeric field across runs, keyed by subject (and events/frame). */
function aggregate(runs) {
  const merge = (lists, keyOf) => {
    const groups = new Map();
    for (const item of lists.flat()) groups.set(keyOf(item), [...(groups.get(keyOf(item)) ?? []), item]);
    return [...groups.values()].map((items) => {
      const out = { ...items[0] };
      for (const [k, v] of Object.entries(items[0])) if (typeof v === 'number') out[k] = median(items.map((i) => i[k]));
      return out;
    });
  };
  const delivered = runs.map((r) => r.delivery).filter(Boolean);
  return {
    platform: runs[0].platform,
    osVersion: runs[0].osVersion,
    build: 'release',
    runs: runs.length,
    dates: runs.map((r) => r.date),
    latency: merge(runs.map((r) => r.latency), (l) => l.subject),
    frames: merge(runs.map((r) => r.frames), (f) => `${f.subject}-${f.perFrame}`),
    delivery: delivered.length ? { events: delivered[0].events, ms: median(delivered.map((d) => d.ms)) } : null,
  };
}

const byPlatform = new Map();
for (const r of reports.filter((r) => r.build === 'release')) byPlatform.set(r.platform, [...(byPlatform.get(r.platform) ?? []), r]);
const kept = [...byPlatform.values()].map(aggregate).sort((a, b) => a.platform.localeCompare(b.platform));
if (!kept.length) throw new Error('No release report found');

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(kept, null, 2) + '\n');

// Grouped horizontal bars: p50 and p99 per subject, one block per platform.
const subjects = ['noop', 'naive', 'shipstat'];
const labels = { noop: 'empty function', naive: 'naive JS SDK', shipstat: 'Shipstat' };
const colors = { p50: '#4f46e5', p99: '#a5b4fc' };
const max = Math.max(...kept.flatMap((r) => r.latency.map((l) => l.p99Us)));
const scale = (v) => Math.max(1.5, (v / max) * 430);
const rowH = 44;
const blockH = subjects.length * rowH + 40;
const width = 860;
const height = kept.length * blockH + 30;
let y = 50;
const parts = [];
for (const r of kept) {
  parts.push(`<text x="8" y="${y}" class="h">${r.platform === 'ios' ? 'iOS simulator' : 'Android emulator'} · release build · median of ${r.runs} runs</text>`);
  y += 16;
  for (const s of subjects) {
    const l = r.latency.find((x) => x.subject === s);
    parts.push(`<text x="8" y="${y + 17}" class="l">${labels[s]}</text>`);
    parts.push(`<rect x="150" y="${y + 4}" width="${scale(l.p99Us).toFixed(1)}" height="14" rx="3" fill="${colors.p99}"/>`);
    parts.push(`<rect x="150" y="${y + 4}" width="${scale(l.p50Us).toFixed(1)}" height="14" rx="3" fill="${colors.p50}"/>`);
    parts.push(`<text x="${(160 + scale(l.p99Us)).toFixed(1)}" y="${y + 16}" class="v">p50 ${l.p50Us.toFixed(1)} µs · p99 ${l.p99Us.toFixed(1)} µs</text>`);
    y += rowH - 14;
  }
  y += 40;
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Inter, -apple-system, Segoe UI, sans-serif">
<style>.t{font-size:16px;font-weight:700;fill:#18181b}.h{font-size:13px;font-weight:600;fill:#62626b}.l{font-size:13px;fill:#18181b}.v{font-size:12px;fill:#62626b}</style>
<rect width="100%" height="100%" fill="#ffffff"/>
<text x="8" y="22" class="t">Cost of one track() call on the JS thread (lower is better)</text>
<rect x="560" y="10" width="12" height="12" rx="3" fill="#4f46e5"/><text x="578" y="21" class="v">p50</text><rect x="620" y="10" width="12" height="12" rx="3" fill="#a5b4fc"/><text x="638" y="21" class="v">p99</text>
${parts.join('\n')}
</svg>
`;
fs.writeFileSync(path.join(outDir, 'latency.svg'), svg);

const fmt = (n) => n.toFixed(1);
for (const r of kept) {
  console.log(`\n### ${r.platform} (${r.build}, OS ${r.osVersion}, median of ${r.runs} runs)\n`);
  console.log('| | p50 | p95 | p99 | mean | max |\n|---|---:|---:|---:|---:|---:|');
  for (const l of r.latency) console.log(`| ${labels[l.subject]} | ${fmt(l.p50Us)} | ${fmt(l.p95Us)} | ${fmt(l.p99Us)} | ${fmt(l.meanUs)} | ${fmt(l.maxUs)} |`);
  console.log('\n| events / s | subject | JS fps | long frames |\n|---:|---|---:|---:|');
  for (const f of r.frames) console.log(`| ${f.eventsPerSecond} | ${labels[f.subject]} | ${f.fps.toFixed(1)} | ${f.longFrames} |`);
  console.log(`\nDelivery: ${r.delivery ? `${r.delivery.events} events stored in ${(r.delivery.ms / 1000).toFixed(2)} s` : 'n/a'}`);
}
