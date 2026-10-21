// Integration tour: loads the real game, visits scenarios, saves screenshots + stats.
// Usage: node scripts/tour.mjs <baseUrl> <outDir> [scenarioName,...]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const [base = 'http://localhost:5173', outDir = '.', only] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const S = [
  { name: 'noon-high',    q: 'high',   time: 12,   y: null, yaw: 30,  pitch: -4 },
  { name: 'sunset-high',  q: 'high',   time: 17.9, y: null, yaw: 250, pitch: 2 },
  { name: 'aerial-ultra', q: 'ultra',  time: 10,   y: 170,  yaw: 120, pitch: -12 },
  { name: 'night-high',   q: 'high',   time: 23,   y: null, yaw: 0,   pitch: 10 },
  { name: 'potato',       q: 'potato', time: 9,    y: null, yaw: 60,  pitch: -3 },
  { name: 'low-aerial',   q: 'low',    time: 14,   y: 140,  yaw: 200, pitch: -10 },
].filter(s => !only || only.split(',').includes(s.name));
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'],
});
for (const s of S) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const logs = [];
  page.on('console', m => { if (['error', 'warning'].includes(m.type()) || m.text().startsWith('[HZ]')) logs.push(`[${m.type()}] ${m.text().slice(0, 300)}`); });
  page.on('pageerror', e => logs.push('[pageerror] ' + String(e.stack || e).slice(0, 600)));
  const t0 = Date.now();
  await page.goto(`${base}/?autostart=1&quality=${s.q}&seed=1337&time=${s.time}`, { waitUntil: 'load' });
  await page.waitForFunction('window.__hz && window.__hz.ready', null, { timeout: 120000 }).catch(() => logs.push('[tour] ready timeout'));
  const tReady = Date.now() - t0;
  await page.evaluate(({ y, yaw, pitch, time }) => {
    const hz = window.__hz; hz.setTime(time);
    if (y != null) { const p = hz.camera.position; hz.teleport(p.x, y, p.z); }
    hz.lookAt(yaw, pitch);
  }, s);
  await page.waitForTimeout(+(process.env.SETTLE || 12000));
  const stats = await page.evaluate(() => { const hz = window.__hz; try { return { world: hz.world.stats(), render: hz.gameRenderer.info() }; } catch (e) { return String(e); } });
  await page.screenshot({ path: `${outDir}/${s.name}.png` });
  console.log(`== ${s.name} ready in ${(tReady / 1000).toFixed(1)}s`, JSON.stringify(stats));
  for (const l of logs.slice(0, 12)) console.log('  ', l);
  await page.close();
}
await browser.close();
