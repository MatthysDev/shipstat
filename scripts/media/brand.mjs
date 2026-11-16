// Renders the logo lockups and icons from docs/brand/*.svg (PNG for READMEs, stores, OG).
//
//   node scripts/media/brand.mjs
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const dir = path.resolve('docs/brand');
const mark = fs.readFileSync(path.join(dir, 'mark.svg'), 'utf8');
const markDark = fs.readFileSync(path.join(dir, 'mark-dark.svg'), 'utf8');
const font = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;800&display=swap">';
const lockup = (svg, ink, bg) => `${font}<body style="margin:0;background:${bg}"><div style="display:inline-flex;align-items:center;gap:22px;padding:28px 36px 28px 28px">
  <div style="width:96px;height:96px">${svg}</div>
  <span style="font:800 84px 'Plus Jakarta Sans';letter-spacing:-.05em;color:${ink};line-height:1">shipstat</span></div></body>`;

const jobs = [
  { name: 'logo-light.png', html: lockup(mark, '#14150f', 'transparent'), transparent: true },
  { name: 'logo-dark.png', html: lockup(markDark, '#f1f0ea', 'transparent'), transparent: true },
  ...[[32, 'favicon-32.png'], [180, 'apple-touch-icon.png'], [512, 'icon-512.png']].map(([size, name]) => ({
    name,
    size,
    // The Apple and store icons fill the square: the platform applies its own corner mask.
    html: `<body style="margin:0">${(size >= 180 ? mark.replace('rx="16"', 'rx="0"') : mark).replace('<svg ', `<svg width="${size}" height="${size}" `)}</body>`,
    transparent: size < 180,
  })),
];

const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage();
for (const j of jobs) {
  await page.setViewport({ width: j.size ?? 900, height: j.size ?? 200, deviceScaleFactor: j.size ? 1 : 2 });
  await page.setContent(`<!doctype html><html>${j.html}</html>`, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const el = j.size ? null : await page.$('div');
  const opts = { path: path.join(dir, j.name), omitBackground: j.transparent };
  if (el) await el.screenshot(opts);
  else await page.screenshot({ ...opts, clip: { x: 0, y: 0, width: j.size, height: j.size } });
  console.log('brand', j.name);
}
await browser.close();
