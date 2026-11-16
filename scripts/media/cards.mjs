// Renders the still frames of the promo video (1920×1080) with the site's typography.
//
//   node scripts/media/cards.mjs <outDir>
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const out = path.resolve(process.argv[2] ?? '/tmp/shipstat-cards');
fs.mkdirSync(out, { recursive: true });
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const mark = `<span class="mark"><svg width="22" height="22" viewBox="0 0 12 12"><rect x="1" y="6" width="2.4" height="5" rx=".6" fill="currentColor"/><rect x="4.8" y="3.5" width="2.4" height="7.5" rx=".6" fill="currentColor"/><rect x="8.6" y="1" width="2.4" height="10" rx=".6" fill="currentColor"/></svg></span>`;

const base = `
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap">
<style>
  * { box-sizing: border-box; margin: 0; }
  body { width: 1920px; height: 1080px; background: #fff; color: #0a0a0a; font-family: Geist, sans-serif; -webkit-font-smoothing: antialiased; position: relative; overflow: hidden; }
  .mono { font-family: "Geist Mono", monospace; }
  .eyebrow { font: 500 22px "Geist Mono", monospace; letter-spacing: .1em; text-transform: uppercase; color: #9a9a9a; }
  .logo { display: flex; align-items: center; gap: 16px; font-size: 34px; font-weight: 600; letter-spacing: -.03em; }
  .mark { width: 44px; height: 44px; border-radius: 10px; background: #0a0a0a; color: #fff; display: grid; place-items: center; }
  h1 { font-size: 132px; line-height: .95; letter-spacing: -.055em; font-weight: 600; }
  h2 { font-size: 64px; letter-spacing: -.045em; font-weight: 600; line-height: 1; }
  .soft { color: #a3a3a3; }
  .accent { color: #f2542d; }
  .line { position: absolute; left: 120px; right: 120px; height: 1px; background: #ececec; }
</style>`;

const pages = {
  title: `${base}
    <div style="position:absolute; left:120px; top:110px" class="logo">${mark}Shipstat</div>
    <div style="position:absolute; left:120px; top:360px">
      <h1>Know if what you shipped<br><span class="soft">works better.</span></h1>
      <p class="eyebrow" style="margin-top:56px">Open source analytics &amp; A/B testing · React Native &amp; Expo</p>
    </div>`,

  // Background of the split scene: the two videos are laid over the empty frames.
  split: `${base}
    <div style="position:absolute; left:120px; top:72px; display:flex; gap:20px; align-items:baseline"><span class="eyebrow accent">01</span><span class="eyebrow" style="color:#0a0a0a">Your app</span><span class="eyebrow">Shipstat.track()</span></div>
    <div style="position:absolute; left:720px; top:72px; display:flex; gap:20px; align-items:baseline"><span class="eyebrow accent">02</span><span class="eyebrow" style="color:#0a0a0a">Your dashboard</span><span class="eyebrow">live, in the browser</span></div>
    <div style="position:absolute; left:120px; top:140px; width:462px; height:880px; border:2px solid #ececec; border-radius:28px"></div>
    <div style="position:absolute; left:720px; top:140px; width:1080px; height:726px; border:2px solid #ececec; border-radius:14px"></div>
    <div style="position:absolute; left:720px; top:920px; font-size:40px; font-weight:600; letter-spacing:-.035em">A tap in the app. The event on the dashboard. <span class="soft">About a second.</span></div>`,

  release: `${base}
    <div style="position:absolute; left:120px; top:96px"><p class="eyebrow">Every release</p><h2 style="margin-top:20px">Split any number by version,<br><span class="soft">build or OTA update.</span></h2></div>`,

  abtest: `${base}
    <div style="position:absolute; left:120px; top:96px"><p class="eyebrow">A/B tests</p><h2 style="margin-top:20px">Probability that B beats A,<br><span class="soft">overall and per version.</span></h2></div>`,

  end: `${base}
    <div style="position:absolute; left:120px; top:110px" class="logo">${mark}Shipstat</div>
    <div style="position:absolute; left:120px; top:330px">
      <h2 style="font-size:96px">Three lines. One command.</h2>
      <div class="mono" style="margin-top:64px; font-size:40px; line-height:1.9">
        <div><span class="soft">$</span> npx expo install shipstat</div>
        <div><span class="soft">→</span> Shipstat.track(<span class="accent">'paywall_viewed'</span>)</div>
        <div><span class="soft">$</span> npx shipstat-dashboard</div>
      </div>
    </div>
    <div class="line" style="top:930px"></div>
    <div class="mono" style="position:absolute; left:120px; top:960px; font-size:24px; color:#9a9a9a">github.com/MatthysDev/shipstat · MIT</div>`,
};

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
for (const [name, html] of Object.entries(pages)) {
  await page.setContent(`<!doctype html><html><body>${html}</body></html>`, { waitUntil: 'load', timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(out, `${name}.png`) });
  console.log('card', name);
}
await browser.close();
