// Headless-Chromium screenshot helper (software WebGL2 via SwiftShader).
// Usage: node scripts/shot.mjs <url> <out.png> [--wait=ms] [--w=1280] [--h=720] [--ready="js expr"] [--eval="js to run before shot"] [--eval2="js after eval + 1s"] [--json="js expr returning JSON-able, printed"]
// Prints console errors/warnings + page errors. Exit code 0 even on JS errors (read the output!).
import { chromium } from 'playwright-core';
const args = process.argv.slice(2);
const url = args[0], out = args[1] || 'shot.png';
const opt = Object.fromEntries(args.slice(2).filter(a => a.startsWith('--')).map(a => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)]; }));
const W = +(opt.w || 1280), H = +(opt.h || 720), WAIT = +(opt.wait || 4000);
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-dev-shm-usage', '--enable-features=SharedArrayBuffer'],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on('console', m => { const t = m.type(); if (t === 'error' || t === 'warning' || opt.verbose || m.text().startsWith('[HZ]')) console.log(`[console.${t}]`, m.text().slice(0, 600)); });
page.on('pageerror', e => console.log('[pageerror]', String(e.stack || e).slice(0, 1200)));
await page.goto(url, { waitUntil: 'load' });
if (opt.ready) await page.waitForFunction(opt.ready, null, { timeout: +(opt.readyTimeout || 60000) }).catch(e => console.log('[ready timeout]', e.message.slice(0, 200)));
await page.waitForTimeout(WAIT);
if (opt.eval) { await page.evaluate(opt.eval).catch(e => console.log('[eval error]', e.message.slice(0, 300))); await page.waitForTimeout(+(opt.wait2 || 1500)); }
if (opt.eval2) { await page.evaluate(opt.eval2).catch(e => console.log('[eval2 error]', e.message.slice(0, 300))); await page.waitForTimeout(+(opt.wait2 || 1500)); }
if (opt.json) { const r = await page.evaluate(opt.json).catch(e => 'ERR ' + e.message); console.log('[json]', JSON.stringify(r)); }
await page.screenshot({ path: out });
console.log('saved', out);
await browser.close();
