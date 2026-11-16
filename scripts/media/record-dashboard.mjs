// Records the dashboard (light theme, Live board) while events arrive.
// Prints the recording start time (epoch ms) so another recording can be aligned to it.
//
//   node scripts/media/record-dashboard.mjs <out.webm> <seconds>
import puppeteer from 'puppeteer-core';
import { liveBoard, overviewBoard } from './fixtures.mjs';

const [out = '/tmp/dashboard.webm', seconds = '40'] = process.argv.slice(2);
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.SHIPSTAT_URL ?? 'http://localhost:8787';

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--hide-scrollbars'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 968, deviceScaleFactor: 1 });
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
await page.evaluateOnNewDocument((boards) => localStorage.setItem('shipstat.boards.v1', JSON.stringify(boards)), [liveBoard, overviewBoard]);
await page.goto(`${BASE}/#boards/live`, { waitUntil: 'networkidle0' });
await page.waitForSelector('.feed li', { timeout: 90000 });
await page.evaluate(() => document.fonts.ready);
await new Promise((r) => setTimeout(r, 1500));

const recorder = await page.screencast({ path: out, scale: 0.75 });
console.log(`START ${Date.now()}`);
await new Promise((r) => setTimeout(r, Number(seconds) * 1000));
await recorder.stop();
console.log(`STOP ${Date.now()}`);
await browser.close();
