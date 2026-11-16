// Screenshots of the dashboard in light and dark, for the README and the site.
// Needs `npx shipstat-dashboard --demo` running on :8787.
//
//   node scripts/media/capture.mjs
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { overviewBoard, paywallTest } from './fixtures.mjs';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.SHIPSTAT_URL ?? 'http://localhost:8787';
const OUT = [path.resolve('docs/media'), path.resolve('apps/site/assets')];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shoot(page, name, clip) {
  for (const dir of OUT) {
    fs.mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, `${name}.png`), clip, type: 'png' });
  }
  console.log('saved', name);
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--hide-scrollbars'] });
for (const theme of ['light', 'dark']) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);
  await page.evaluateOnNewDocument(
    (boards, tests) => {
      localStorage.setItem('shipstat.boards.v1', JSON.stringify(boards));
      localStorage.setItem('shipstat.experiments.v1', JSON.stringify(tests));
    },
    [overviewBoard],
    [paywallTest]
  );
  const open = async (hash, ready) => {
    await page.goto(`${BASE}/${hash}`, { waitUntil: 'networkidle0' });
    await page.waitForSelector(ready, { timeout: 60000 });
    await page.evaluate(() => document.fonts.ready);
    await sleep(1500);
  };
  const full = { x: 0, y: 0, width: 1440, height: 900 };

  await open('#boards', '.board-grid .number-widget');
  await shoot(page, `board-${theme}`, full);

  await open('#event/paywall_viewed', '.chart svg path');
  await shoot(page, `event-${theme}`, full);

  await open('#experiments', '.verdict');
  await shoot(page, `ab-${theme}`, full);

  await open('#boards', '.funnel');
  await page.evaluate(() => {
    const card = [...document.querySelectorAll('.widget')].find((c) => c.querySelector('h2')?.textContent?.includes('funnel'));
    card?.querySelector('button[title="Edit"]')?.click();
  });
  await page.waitForSelector('.editor .funnel');
  await sleep(1200);
  await shoot(page, `editor-${theme}`, full);
  await ctx.close();
}
await browser.close();
