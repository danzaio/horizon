// HUD for the items feature: hearts, air bubbles, jetpack fuel, damage flash, death screen, kill feed, floating damage numbers, camera shake.
// Pure DOM/canvas. Everything is event-driven; update() returns immediately when nothing is animating.

const HEART = ['.XX...XX.', 'XXXX.XXXX', 'XXXXXXXXX', 'XXXXXXXXX', '.XXXXXXX.', '..XXXXX..', '...XXX...', '....X....'];
const BUBBLE = ['..XXXX..', '.X....X.', 'X..XX..X', 'X.X....X', 'X......X', 'X......X', '.X....X.', '..XXXX..'];

function px(g, map, ox, oy, s, fill) {
  for (let y = 0; y < map.length; y++) for (let x = 0; x < map[y].length; x++) if (map[y][x] === 'X') { g.fillStyle = fill(x, y); g.fillRect(ox + x * s, oy + y * s, s, s); }
}

export class Hud {
  /** @param {{ui:object}} o */
  constructor({ ui }) {
    this.ui = ui;
    const root = this.root = document.createElement('div'); root.id = 'hz-items-hud';
    root.innerHTML = '<canvas class="hz-hearts" width="210" height="20"></canvas><canvas class="hz-air hidden" width="160" height="18"></canvas>' +
      '<div class="hz-fuel hidden"><i></i></div><div class="hz-hitm"><b></b><b></b><b></b><b></b></div><div class="hz-dash"><i></i><i></i></div><div class="hz-flash"></div><div class="hz-feed"></div><div class="hz-floats"></div>';
    (document.getElementById('hud') || document.body).appendChild(root);
    this.hearts = root.querySelector('.hz-hearts'); this.air = root.querySelector('.hz-air'); this.fuel = root.querySelector('.hz-fuel'); this.fuelBar = this.fuel.firstChild;
    this.hitm = root.querySelector('.hz-hitm'); this.dashEl = root.querySelector('.hz-dash'); this._dash = -1; this._hitT = 0;
    this.flashEl = root.querySelector('.hz-flash'); this.feed = root.querySelector('.hz-feed'); this.floats = root.querySelector('.hz-floats');
    this.death = document.createElement('div'); this.death.className = 'hz-death hidden';
    this.death.innerHTML = '<div class="hz-death-box"><h1>Você morreu</h1><p class="hz-cause"></p><button class="btn primary hz-respawn">Renascer</button><p class="note">Enter também renasce</p></div>';
    document.body.appendChild(this.death);
    this.btn = this.death.querySelector('.hz-respawn'); this.cause = this.death.querySelector('.hz-cause');
    this._hp = -1; this._max = -1; this._air = -2; this._fuel = -2;
    this.shakeAmt = 0; this.pool = []; this.live = 0;
    for (let i = 0; i < 10; i++) { const d = document.createElement('div'); d.className = 'hz-float'; d.style.display = 'none'; this.floats.appendChild(d); this.pool.push({ el: d, x: 0, y: 0, z: 0, t: 0, on: false }); }
  }

  setHearts(hp, max) {
    hp = Math.max(0, Math.ceil(hp)); if (hp === this._hp && max === this._max) return;
    this._hp = hp; this._max = max;
    const g = this.hearts.getContext('2d'), n = Math.ceil(max / 2);
    g.clearRect(0, 0, 210, 20);
    for (let i = 0; i < n; i++) {
      const ox = i * 21 + 1, full = hp >= (i + 1) * 2, half = !full && hp === i * 2 + 1;
      px(g, HEART, ox, 1, 2, () => 'rgba(10,6,10,.55)');
      px(g, HEART, ox, 1, 2, (x, y) => (full || (half && x < 5)) ? (y < 2 && x > 0 && x < 4 ? '#ff8a8a' : y > 4 ? '#b31d2a' : '#e8383d') : 'rgba(255,255,255,.12)');
    }
    this.hearts.classList.toggle('low', hp <= 6 && hp > 0);
  }

  setAir(f) { // null = hidden; 0..1 = fraction
    const v = f == null ? -1 : Math.round(f * 20); if (v === this._air) return;
    this._air = v; this.air.classList.toggle('hidden', f == null);
    if (f == null) return;
    const g = this.air.getContext('2d'); g.clearRect(0, 0, 160, 18);
    const n = Math.ceil(f * 10);
    for (let i = 0; i < 10; i++) px(g, BUBBLE, 160 - (i + 1) * 16, 1, 2, () => (i < n ? 'rgba(150,215,255,.95)' : 'rgba(150,215,255,0)'));
  }

  setFuel(f) { // null = hidden
    const v = f == null ? -1 : Math.round(f * 100); if (v === this._fuel) return;
    this._fuel = v; this.fuel.classList.toggle('hidden', f == null);
    if (f != null) { this.fuelBar.style.width = v + '%'; this.fuel.classList.toggle('low', f < 0.2); }
  }

  /** red vignette; strength 0..1 */
  flash(strength = 0.6) {
    const el = this.flashEl; el.style.transition = 'none'; el.style.opacity = String(Math.min(1, strength));
    void el.offsetWidth; el.style.transition = 'opacity .55s ease-out'; el.style.opacity = '0';
  }

  /** crosshair X on a confirmed hit (red + longer on headshot / kill) */
  hitmarker(kill = false, head = false) {
    const el = this.hitm; el.classList.toggle('kill', !!(kill || head)); el.style.transition = 'none'; el.style.opacity = '1';
    void el.offsetWidth; el.style.transition = 'opacity ' + (kill || head ? 0.5 : 0.28) + 's ease-out'; el.style.opacity = '0';
  }

  /** dash charges: n of max lit, `frac` = recharge progress of the next one */
  setDash(n, max, frac) {
    const v = n * 10 + Math.round(frac * 9); if (v === this._dash) return; this._dash = v;
    const pips = this.dashEl.children;
    for (let i = 0; i < pips.length; i++) { pips[i].style.opacity = i < n ? '1' : '0.25'; pips[i].style.setProperty('--f', i === n ? String(frac) : i < n ? '1' : '0'); }
  }

  shake(a) { this.shakeAmt = Math.max(this.shakeAmt, a); }

  killFeed(text) {
    const d = document.createElement('div'); d.className = 'hz-feed-line'; d.textContent = text;
    this.feed.appendChild(d); while (this.feed.children.length > 4) this.feed.firstChild.remove();
    setTimeout(() => d.remove(), 5200);
  }

  /** rising number at a world position (damage dealt) */
  floatText(x, y, z, text, color = '#fff') {
    const f = this.pool.find((p) => !p.on) || this.pool[0];
    f.on = true; f.x = x; f.y = y; f.z = z; f.t = 0; f.el.textContent = text; f.el.style.color = color; f.el.style.display = 'block'; this.live++;
  }

  showDeath(cause, onRespawn) {
    this.cause.textContent = cause || ''; this.death.classList.remove('hidden'); this.btn.onclick = onRespawn;
    this._key = (e) => { if (e.code === 'Enter') { e.preventDefault(); onRespawn(); } };
    document.addEventListener('keydown', this._key, true);
    setTimeout(() => this.btn.focus(), 60);
  }
  hideDeath() { this.death.classList.add('hidden'); if (this._key) document.removeEventListener('keydown', this._key, true); this._key = null; }

  /** per frame: shake + floating numbers (cheap early-outs) */
  update(dt, camera) {
    if (this.shakeAmt > 0.001) {
      const a = this.shakeAmt; camera.rotation.x += (Math.random() - 0.5) * a; camera.rotation.y += (Math.random() - 0.5) * a; camera.rotation.z += (Math.random() - 0.5) * a * 0.6;
      this.shakeAmt *= Math.exp(-7 * dt);
    } else this.shakeAmt = 0;
    if (this.live === 0) return;
    const w = innerWidth, h = innerHeight;
    for (const f of this.pool) {
      if (!f.on) continue;
      f.t += dt;
      if (f.t > 0.9) { f.on = false; f.el.style.display = 'none'; this.live--; continue; }
      // project the (rising) point into the camera: camera-space maths on plain numbers, no allocations
      const e = camera.matrixWorldInverse.elements, px = f.x - 0, py = f.y + f.t * 0.9, pz = f.z;
      const cx = e[0] * px + e[4] * py + e[8] * pz + e[12], cy = e[1] * px + e[5] * py + e[9] * pz + e[13], cz = e[2] * px + e[6] * py + e[10] * pz + e[14], cw = e[3] * px + e[7] * py + e[11] * pz + e[15];
      const q = camera.projectionMatrix.elements, X = q[0] * cx + q[4] * cy + q[8] * cz + q[12] * cw, Y = q[1] * cx + q[5] * cy + q[9] * cz + q[13] * cw, W = q[3] * cx + q[7] * cy + q[11] * cz + q[15] * cw;
      if (W <= 0.05) { f.el.style.opacity = '0'; continue; }
      f.el.style.opacity = String(Math.min(1, (0.9 - f.t) * 3));
      f.el.style.transform = `translate(${((X / W) * 0.5 + 0.5) * w}px, ${(1 - ((Y / W) * 0.5 + 0.5)) * h}px) translate(-50%,-50%) scale(${1.2 - f.t * 0.3})`;
    }
  }

  dispose() { this.root.remove(); this.death.remove(); this.hideDeath(); }
}
