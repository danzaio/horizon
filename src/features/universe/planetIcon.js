// Procedural planet icons (canvas 2D, no assets): shaded sphere tinted by the planet's palette, clouds, rings and moons.
import { rng32 } from './generator.js';

const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const lin2s = (c) => c.map((v) => Math.round(255 * Math.pow(Math.min(1, Math.max(0, v)), 0.4545)));
// per type: [sea?, land?, landCover, cloudAlpha]
const LOOK = {
  verdant: { cover: 0.45, cloud: 0.55 }, lush: { cover: 0.62, cloud: 0.7 }, desert: { cover: 0.92, cloud: 0.12 }, frozen: { cover: 0.9, cloud: 0.35 },
  volcanic: { cover: 0.72, cloud: 0.4 }, ocean: { cover: 0.14, cloud: 0.6 }, alien: { cover: 0.55, cloud: 0.5 }, barren: { cover: 1.0, cloud: 0 },
};

/**
 * Draw a planet icon into a square canvas.
 * @param {HTMLCanvasElement} cv canvas (width = height)
 * @param {{seed:number,type:string,profile:object,planet:{ring:boolean,size:number}}} g result of generatePlanet
 * @param {number} [spin] rotation phase 0..1 (continents slide when animated)
 */
export function drawPlanetIcon(cv, g, spin = 0) {
  const c = cv.getContext('2d'), S = cv.width, cx = S / 2, cy = S / 2, R = S * (g.planet.ring ? 0.3 : 0.36) * (0.85 + 0.15 * g.planet.size);
  const P = g.profile, L = LOOK[g.type] || LOOK.verdant, rng = rng32(g.seed ^ 0x9e3779b9);
  c.clearRect(0, 0, S, S);
  const sea = g.type === 'volcanic' ? [34, 24, 26] : g.type === 'barren' ? [92, 92, 92] : P.palette.water;
  let land = g.type === 'desert' ? (P.sand === 'red' ? [200, 110, 66] : [222, 182, 108]) : g.type === 'frozen' ? [226, 238, 248] : g.type === 'barren' ? [150, 148, 144] : g.type === 'volcanic' ? [64, 56, 58] : P.palette.grass;
  if (g.type === 'verdant' || g.type === 'ocean') land = mixc(land, [70, 130, 70], 0.4);
  const atm = lin2s(P.sky.horizon);
  // atmosphere halo
  let gr = c.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 1.45);
  gr.addColorStop(0, rgb(atm, g.type === 'barren' ? 0.1 : 0.55)); gr.addColorStop(1, rgb(atm, 0));
  c.fillStyle = gr; c.fillRect(0, 0, S, S);
  const ring = (front) => {
    if (!g.planet.ring) return;
    c.save(); c.translate(cx, cy); c.rotate(-0.38);
    for (let i = 0; i < 4; i++) {
      c.beginPath(); c.strokeStyle = rgb(mixc(land, [230, 220, 200], 0.5), 0.18 + 0.12 * ((i + 1) % 2)); c.lineWidth = R * 0.07;
      c.ellipse(0, 0, R * (1.55 + i * 0.1), R * (0.42 + i * 0.03), 0, front ? 0 : Math.PI, front ? Math.PI : Math.PI * 2); c.stroke();
    }
    c.restore();
  };
  ring(false);
  // body
  c.save(); c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.clip();
  c.fillStyle = rgb(sea); c.fillRect(cx - R, cy - R, R * 2, R * 2);
  const n = 10;
  for (let i = 0; i < n; i++) {   // continents: blobs that drift with `spin` and wrap around
    const bx = ((rng() + spin) % 1) * R * 3 - R * 1.5, by = (rng() - 0.5) * R * 1.7, rr = R * (0.22 + rng() * 0.42) * (0.5 + L.cover);
    if (rng() > L.cover + 0.35 && L.cover < 0.9) continue;
    c.fillStyle = rgb(mixc(land, rng() < 0.5 ? [255, 255, 255] : [0, 0, 0], 0.08 + rng() * 0.16));
    c.beginPath(); c.ellipse(cx + bx, cy + by, rr, rr * (0.5 + rng() * 0.5), rng() * 3, 0, Math.PI * 2); c.fill();
  }
  if (g.type === 'volcanic') { c.strokeStyle = 'rgba(255,110,30,.9)'; c.lineWidth = R * 0.03; for (let i = 0; i < 9; i++) { c.beginPath(); const x = cx + (rng() - 0.5) * R * 1.6, y = cy + (rng() - 0.5) * R * 1.6; c.moveTo(x, y); c.lineTo(x + (rng() - 0.5) * R * 0.6, y + (rng() - 0.5) * R * 0.5); c.stroke(); } }
  if (g.type === 'frozen' || g.type === 'ocean') { c.fillStyle = 'rgba(240,248,255,.85)'; c.beginPath(); c.ellipse(cx, cy - R * 0.95, R * 0.7, R * 0.28, 0, 0, Math.PI * 2); c.fill(); c.beginPath(); c.ellipse(cx, cy + R * 0.97, R * 0.55, R * 0.2, 0, 0, Math.PI * 2); c.fill(); }
  if (g.type === 'barren') { c.fillStyle = 'rgba(40,40,40,.28)'; for (let i = 0; i < 14; i++) { c.beginPath(); c.arc(cx + (rng() - 0.5) * R * 1.7, cy + (rng() - 0.5) * R * 1.7, R * (0.04 + rng() * 0.12), 0, 6.3); c.fill(); } }
  c.strokeStyle = `rgba(255,255,255,${L.cloud * 0.5})`; c.lineCap = 'round';   // cloud swirls
  for (let i = 0; i < 9 && L.cloud > 0; i++) { c.lineWidth = R * (0.05 + rng() * 0.08); const y = cy + (rng() - 0.5) * R * 1.8, x = cx + ((rng() + spin * 1.3) % 1) * R * 2.8 - R * 1.4; c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + R * 0.4, y - R * 0.12, x + R * (0.5 + rng() * 0.6), y + R * 0.05); c.stroke(); }
  gr = c.createRadialGradient(cx - R * 0.42, cy - R * 0.45, R * 0.15, cx + R * 0.1, cy + R * 0.1, R * 1.15);   // sunlit from upper left
  gr.addColorStop(0, 'rgba(255,255,255,0.18)'); gr.addColorStop(0.45, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,10,0.82)');
  c.fillStyle = gr; c.fillRect(cx - R, cy - R, R * 2, R * 2);
  c.restore();
  c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.strokeStyle = rgb(atm, 0.5); c.lineWidth = Math.max(1, R * 0.05); c.stroke();
  ring(true);
  const nm = P.sky.moons.length;   // moons
  for (let i = 0; i < nm; i++) { const a = 0.9 + i * 2.1 + spin * 6.28 * 0.2, mr = Math.max(1.5, R * 0.09 * P.sky.moons[i].size / 2); c.fillStyle = rgb(lin2s(P.sky.moons[i].color)); c.beginPath(); c.arc(cx + Math.cos(a) * R * 1.75, cy + Math.sin(a) * R * 0.55 - R * 0.25, mr, 0, 6.3); c.fill(); }
}
