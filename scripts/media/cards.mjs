// Renders the still frames of the promo video (1920×1080) with the site's typography.
//
//   node scripts/media/cards.mjs <outDir>
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const out = path.resolve(process.argv[2] ?? '/tmp/shipstat-cards');
fs.mkdirSync(out, { recursive: true });
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const mark = `<svg width="48" height="48" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#14150f"/><path d="M15 42h14V24h13" fill="none" stroke="#fff" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="49.5" cy="24" r="5" fill="#f2542d"/></svg>`;

const base = `
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&family=Geist+Mono:wght@400;500&family=Caveat:wght@600&display=swap">
<style>
  * { box-sizing: border-box; margin: 0; }
  body { width: 1920px; height: 1080px; background: #fbfaf6; color: #14150f; font-family: 'Plus Jakarta Sans', sans-serif; -webkit-font-smoothing: antialiased; position: relative; overflow: hidden; }
  .mono { font-family: "Geist Mono", monospace; }
  .eyebrow { font-size: 26px; font-weight: 700; color: #f2542d; letter-spacing: -.01em; }
  .badge { display: inline-flex; align-items: center; gap: 12px; padding: 10px 22px 10px 16px; border-radius: 999px; background: #fff; box-shadow: 0 0 0 1px rgba(20,21,15,.06), 0 12px 24px -12px rgba(20,21,15,.12); font-size: 24px; font-weight: 600; color: #6b6c63; }
  .badge i { width: 12px; height: 12px; border-radius: 50%; background: #f2542d; }
  .hand { font-family: Caveat, cursive; font-weight: 600; color: #f2542d; font-size: 1.12em; }
  .step { display: inline-grid; place-items: center; width: 48px; height: 48px; border-radius: 999px; background: #14150f; color: #fff; font-size: 22px; font-weight: 800; }
  .step.a { background: #f2542d; }
  .label { font-size: 26px; font-weight: 800; letter-spacing: -.02em; }
  .sub { font-size: 24px; font-weight: 600; color: #a2a39a; }
  .logo { display: flex; align-items: center; gap: 16px; font-size: 40px; font-weight: 800; letter-spacing: -.05em; }
  .mark { width: 48px; height: 48px; border-radius: 14px; background: #14150f; color: #fff; display: grid; place-items: center; }
  h1 { font-size: 128px; line-height: 1.02; letter-spacing: -.05em; font-weight: 800; }
  h2 { font-size: 68px; letter-spacing: -.045em; font-weight: 800; line-height: 1.04; }
  .soft { color: #a2a39a; }
  .accent { color: #f2542d; }
  .line { position: absolute; left: 120px; right: 120px; height: 1px; background: #ebe9e2; }
  .frame { position: absolute; background: #fff; box-shadow: 0 0 0 1px rgba(20,21,15,.05), 0 3px 3px -1.5px rgba(20,21,15,.05), 0 30px 40px -20px rgba(20,21,15,.12); }
</style>`;

const pages = {
  title: `${base}
    <div style="position:absolute; left:120px; top:110px" class="logo">${mark}shipstat</div>
    <div style="position:absolute; left:120px; top:360px">
      <h1>Know if what you shipped<br>works <span class="hand">better</span>.</h1>
      <p class="badge" style="margin-top:56px"><i></i>Open source analytics &amp; A/B testing · React Native &amp; Expo</p>
    </div>`,

  // Background of the split scene: the two videos are laid over the empty frames.
  split: `${base}
    <div style="position:absolute; left:120px; top:60px; display:flex; gap:16px; align-items:center"><span class="step a">1</span><span class="label">Your app</span><span class="sub">Shipstat.track()</span></div>
    <div style="position:absolute; left:720px; top:60px; display:flex; gap:16px; align-items:center"><span class="step">2</span><span class="label">Your dashboard</span><span class="sub">live, in the browser</span></div>
    <div class="frame" style="left:104px; top:124px; width:494px; height:912px; border-radius:44px"></div>
    <div class="frame" style="left:705px; top:125px; width:1110px; height:756px; border-radius:26px"></div>
    <div style="position:absolute; left:720px; top:930px; font-size:42px; font-weight:800; letter-spacing:-.04em">A tap in the app. The event on the dashboard. <span class="hand">About a second.</span></div>`,

  release: `${base}
    <div style="position:absolute; left:120px; top:96px"><p class="eyebrow">Every release</p><h2 style="margin-top:20px">Split any number by version,<br><span class="soft">build or OTA update.</span></h2></div>`,

  abtest: `${base}
    <div style="position:absolute; left:120px; top:96px"><p class="eyebrow">A/B tests</p><h2 style="margin-top:20px">Probability that B beats A,<br><span class="soft">overall and per version.</span></h2></div>`,

  end: `${base}
    <div style="position:absolute; left:120px; top:110px" class="logo">${mark}shipstat</div>
    <div style="position:absolute; left:120px; top:330px">
      <h2 style="font-size:104px">Three lines. <span class="hand">One command.</span></h2>
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
