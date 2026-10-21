// Capture named viewpoints: node scripts/views.mjs <baseUrl> <outDir> <views.json> [name,name...]
// views.json: [{name, x, z, y?, yaw, pitch, time, q, seed?, fly?}]  (y omitted => ground level at x,z)
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const [base, outDir, file, only] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
let views = JSON.parse(fs.readFileSync(file, 'utf8'));
if (only) views = views.filter(v => only.split(',').includes(v.name));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
for (const v of views) {
  const page = await browser.newPage({ viewport: { width: +(process.env.W || 1280), height: +(process.env.H || 720) } });
  const logs = [];
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text().slice(0, 240)}`); });
  page.on('pageerror', e => logs.push('[pageerror] ' + String(e.stack || e).slice(0, 400)));
  const q = new URLSearchParams({ autostart: 1, hud: process.env.HUD || 0, quality: v.q || 'high', seed: v.seed || 1337, time: v.time ?? 12, x: v.x, z: v.z, yaw: v.yaw ?? 0, pitch: v.pitch ?? 0 });
  if (v.y != null) q.set('y', v.y);
  if (v.fly) q.set('fly', 1);
  if (v.weather) q.set('weather', v.weather);
  const t0 = Date.now();
  await page.goto(`${base}/?${q}`, { waitUntil: 'load' });
  await page.waitForFunction('window.__hz && window.__hz.ready', null, { timeout: 120000 }).catch(() => logs.push('[views] ready timeout'));
  if (v.eval) await page.evaluate(v.eval).catch(e => logs.push('[eval] ' + e.message.slice(0, 200)));
  let quiet = 0;
  for (let i = 0; i < 60 && quiet < 3; i++) {
    await page.waitForTimeout(1000);
    const s = await page.evaluate(() => { const w = window.__hz.world.stats(); return w.chunkQueue + w.lodQueue + w.workersBusy; }).catch(() => 1);
    quiet = s === 0 ? quiet + 1 : 0;
  }
  await page.waitForTimeout(+(process.env.EXTRA || 1500));
  await page.screenshot({ path: `${outDir}/${v.name}.png` });
  const st = await page.evaluate(() => { const hz = window.__hz; const r = hz.gameRenderer.info(); return { calls: r.calls, tris: r.triangles, ch: hz.world.stats().chunks, lod: hz.world.stats().lodTiles }; }).catch(() => ({}));
  console.log(`${v.name}: ${((Date.now() - t0) / 1000).toFixed(0)}s ${JSON.stringify(st)}${logs.length ? '\n  ' + logs.slice(0, 4).join('\n  ') : ''}`);
  await page.close();
}
await browser.close();
