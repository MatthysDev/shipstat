// Static site: the landing page at /, the dashboard opening on demo data at /demo/.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, 'dist');
const dashboard = path.resolve(here, '../../packages/dashboard/dist');
if (!fs.existsSync(dashboard)) throw new Error('Build the dashboard first: pnpm --filter shipstat-dashboard build');

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
for (const f of ['index.html', 'site.css', 'llms.txt']) fs.copyFileSync(path.join(here, f), path.join(dist, f));
// The integration prompt is served next to the page so "Copy the prompt" can fetch it.
fs.mkdirSync(path.join(dist, 'ai'), { recursive: true });
fs.copyFileSync(path.resolve(here, '../../docs/ai/integrate.md'), path.join(dist, 'ai/integrate.md'));
fs.cpSync(path.join(here, 'assets'), path.join(dist, 'assets'), { recursive: true });
fs.cpSync(dashboard, path.join(dist, 'demo'), { recursive: true });
console.log('site built in', path.relative(process.cwd(), dist));
