// Render dev harness: builds test geometry in the CONTRACT formats (no World needed).
import * as THREE from 'three';
import { GameRenderer } from '../GameRenderer.js';
import { TILE_NAMES, tileLayer } from '../../shared/blocks.js';
import { SEA_LEVEL, WATER_TOP, META_SWAY, META_CUTOUT, META_EMISSIVE } from '../../shared/constants.js';

const P = new URLSearchParams(location.search);
const canvas = document.getElementById('c');
const gr = new GameRenderer({ canvas, quality: P.get('quality') || 'high' });
gr.resize(innerWidth, innerHeight);
gr.time.set(+(P.get('time') ?? 12));
gr.time.paused = !P.has('anim');
if (P.has('under')) gr.setUnderwater(true);
addEventListener('resize', () => gr.resize(innerWidth, innerHeight));

const FN = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const L = (n) => tileLayer(n);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function H(x, z) {
  let h = 66 + 14 * Math.sin(x * 0.021 + 1) * Math.cos(z * 0.017) + 8 * Math.sin(x * 0.06 + z * 0.04) + 5 * Math.sin(z * 0.11 + x * 0.03);
  h -= 24 * Math.exp(-(((x - 40) ** 2 + (z - 70) ** 2) / (2 * 34 * 34)));
  h += 100 * smooth(220, 900, x * 0.8 + z * 0.55);
  return Math.floor(h);
}

// ---------- chunk (LOD0) geometry builder ----------
class Builder {
  constructor() { this.pos = []; this.meta = []; this.tint = []; this.idx = []; this.n = 0; }
  quad(face, x, y, z, a, b, layer, tint, flags, ao, light, tintA = 255) {
    // corners in order (u0v0, u1v0, u1v1, u0v1) in block units, tangent axes per face
    let c;
    switch (face) {
      case 0: c = [[x + 1, y, z], [x + 1, y, z + a], [x + 1, y + b, z + a], [x + 1, y + b, z]]; break;
      case 1: c = [[x, y, z + a], [x, y, z], [x, y + b, z], [x, y + b, z + a]]; break;
      case 2: c = [[x, y + 1, z], [x + a, y + 1, z], [x + a, y + 1, z + b], [x, y + 1, z + b]]; break;
      case 3: c = [[x, y, z + b], [x + a, y, z + b], [x + a, y, z], [x, y, z]]; break;
      case 4: c = [[x + a, y, z + 1], [x, y, z + 1], [x, y + b, z + 1], [x + a, y + b, z + 1]]; break;
      default: c = [[x, y, z], [x + a, y, z], [x + a, y + b, z], [x, y + b, z]];
    }
    const uv = [[0, 0], [a, 0], [a, b], [0, b]];
    if (face === 2 || face === 3) { uv[2] = [a, b]; uv[3] = [0, b]; }
    const base = this.n;
    for (let i = 0; i < 4; i++) {
      this.pos.push(Math.round(c[i][0] * 16), Math.round(c[i][1] * 16), Math.round(c[i][2] * 16), layer);
      this.meta.push(face | (ao[i] << 3) | flags, uv[i][0], uv[i][1], light);
      this.tint.push(tint[0], tint[1], tint[2], tintA);
    }
    this.n += 4;
    const e1 = [c[1][0] - c[0][0], c[1][1] - c[0][1], c[1][2] - c[0][2]], e2 = [c[2][0] - c[0][0], c[2][1] - c[0][1], c[2][2] - c[0][2]];
    const nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
    const fn = FN[face], flip = nx * fn[0] + ny * fn[1] + nz * fn[2] < 0;
    this.idx.push(...(flip ? [base, base + 2, base + 1, base, base + 3, base + 2] : [base, base + 1, base + 2, base, base + 2, base + 3]));
  }
  cross(x, y, z, layer, tint, flags, light) {
    const d = [[[x, y, z], [x + 1, y, z + 1], [x + 1, y + 1, z + 1], [x, y + 1, z]], [[x + 1, y, z], [x, y, z + 1], [x, y + 1, z + 1], [x + 1, y + 1, z]]];
    for (const q of d) for (const rev of [false, true]) {
      const base = this.n;
      for (let i = 0; i < 4; i++) {
        const v = q[i];
        this.pos.push(Math.round(v[0] * 16), Math.round(v[1] * 16), Math.round(v[2] * 16), layer);
        this.meta.push(6 | (3 << 3) | flags, i === 1 || i === 2 ? 1 : 0, i >= 2 ? 1 : 0, light);
        this.tint.push(tint[0], tint[1], tint[2], 255);
      }
      this.n += 4;
      this.idx.push(...(rev ? [base, base + 2, base + 1, base, base + 3, base + 2] : [base, base + 1, base + 2, base, base + 2, base + 3]));
    }
  }
  cube(x, y, z, layers, tint, flags, light) {
    for (let f = 0; f < 6; f++) this.quad(f, x, y, z, 1, 1, layers[f] ?? layers[0], tint, flags, [3, 3, 3, 3], light);
  }
  geometry(minY, maxY, ox, oz) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('aPos', new THREE.BufferAttribute(new Uint16Array(this.pos), 4));
    g.setAttribute('aMeta', new THREE.BufferAttribute(new Uint8Array(this.meta), 4));
    g.setAttribute('aTint', new THREE.BufferAttribute(new Uint8Array(this.tint), 4, true));
    g.setIndex(new THREE.BufferAttribute(this.n > 65000 ? new Uint32Array(this.idx) : new Uint16Array(this.idx), 1));
    g.boundingBox = new THREE.Box3(new THREE.Vector3(0, minY, 0), new THREE.Vector3(32, maxY, 32));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(16, (minY + maxY) / 2, 16), 40 + (maxY - minY));
    return g;
  }
}
const hash = (x, z) => { let h = Math.imul(x, 374761393) ^ Math.imul(z, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const LIGHT = (15 << 4);
const casters = [];
function buildChunk(cx, cz) {
  const S = new Builder(), W = new Builder();
  const ox = cx * 32, oz = cz * 32;
  let minY = 999, maxY = 0;
  const hs = (x, z) => H(ox + x, oz + z);
  for (let x = 0; x < 32; x++) for (let z = 0; z < 32; z++) {
    const h = hs(x, z), wx = ox + x, wz = oz + z;
    minY = Math.min(minY, h); maxY = Math.max(maxY, h + 1);
    const under = h <= SEA_LEVEL, snow = h > 112, sandy = h <= SEA_LEVEL + 2, rocky = h > 98;
    const tint = under || sandy || snow || rocky ? [255, 255, 255] : [128 + hash(wx >> 3, wz >> 3) * 24, 182 + hash(wz >> 3, wx >> 3) * 16, 78];
    const topTile = snow ? 'snow' : sandy ? 'sand' : rocky ? 'stone' : 'grass_top';
    S.quad(2, x, h, z, 1, 1, L(topTile), tint, 0, [3, 3, 3, 3], LIGHT);
    // sides
    const nb = [[1, 0], [-1, 0], null, null, [0, 1], [0, -1]];
    for (const f of [0, 1, 4, 5]) {
      const [dx, dz] = nb[f];
      const nh = (x + dx < 0 || x + dx > 31 || z + dz < 0 || z + dz > 31) ? H(wx + dx, wz + dz) : hs(x + dx, z + dz);
      if (nh >= h) continue;
      const topSide = snow ? 'grass_side_snow' : sandy ? 'sand' : rocky ? 'stone' : 'grass_side';
      const y0 = nh + 1;
      S.quad(f, x, h, z, 1, 1, L(topSide), tint, 0, [3, 3, 2, 2], LIGHT);
      if (h - y0 > 0) {
        const mid = h - 3;
        if (mid > y0) { S.quad(f, x, y0, z, 1, mid - y0, L('stone'), [255, 255, 255], 0, [2, 2, 3, 3], LIGHT); }
        const dy0 = Math.max(y0, mid);
        if (h - dy0 > 0) S.quad(f, x, dy0, z, 1, h - dy0, L(sandy ? 'sand' : 'dirt'), [255, 255, 255], 0, [2, 2, 3, 3], LIGHT);
      }
    }
    if (under) {
      const depth = Math.min(SEA_LEVEL - h + 1, 16) / 16;
      W.quad(2, x, SEA_LEVEL + WATER_TOP - 1, z, 1, 1, 0, [45, 100, 205], 0, [3, 3, 3, 3], LIGHT, Math.round(depth * 255));
    } else if (!snow && !sandy && !rocky) {
      const r = hash(wx, wz);
      if (r < 0.012) { // tree
        const th = 4 + Math.floor(hash(wz, wx) * 3);
        for (let i = 1; i <= th; i++) S.cube(x, h + i, z, [L('log_oak_side'), L('log_oak_side'), L('log_oak_top'), L('log_oak_top'), L('log_oak_side'), L('log_oak_side')], [255, 255, 255], 0, LIGHT);
        if (x > 2 && x < 29 && z > 2 && z < 29) for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let dy = th - 1; dy <= th + 1; dy++) {
          const d = Math.abs(dx) + Math.abs(dz) + Math.max(0, dy - th) * 2;
          if (d > 3 || (dx === 0 && dz === 0 && dy < th + 1)) continue;
          if ((dx * 7 + dz * 3 + dy) % 5 === 0 && d > 2) continue;
          S.cube(x + dx, h + 1 + dy, z + dz, [L('leaves_oak')], [112, 172, 60], META_SWAY | META_CUTOUT, LIGHT);
        }
      } else if (r < 0.2) S.cross(x, h + 1, z, L('tall_grass'), [128, 186, 76], META_SWAY | META_CUTOUT, LIGHT);
      else if (r < 0.225) S.cross(x, h + 1, z, L(hash(wz, wx) > 0.5 ? 'flower_red' : 'flower_yellow'), [255, 255, 255], META_SWAY | META_CUTOUT, LIGHT);
    } else if (sandy && !under && hash(wx, wz) < 0.01) S.cross(x, h + 1, z, L('dead_bush'), [255, 255, 255], META_SWAY | META_CUTOUT, LIGHT);
  }
  // tile showcase row on chunk (0,0)
  if (cx === 0 && cz === 0) {
    TILE_NAMES.forEach((name, i) => {
      if (name === 'water') return;
      const x = 2 + (i % 19), z = 3 + Math.floor(i / 19) * 2, h = hs(x, z) + 1;
      const em = name === 'glowstone' || name === 'lava' ? META_EMISSIVE : 0;
      const cut = /leaves|glass|tall_grass|flower|dead_bush/.test(name) ? META_CUTOUT : 0;
      const tint = name === 'grass_top' || name === 'grass_side' || name === 'leaves_oak' || name === 'tall_grass' ? [128, 186, 76] : [255, 255, 255];
      const light = em ? LIGHT | 15 : LIGHT;
      if (name === 'tall_grass' || name.startsWith('flower') || name === 'dead_bush') S.cross(x, h + 3, z, L(name), tint, META_SWAY | META_CUTOUT, light);
      else S.cube(x, h + 3, z, [L(name)], tint, em | cut, light);
      maxY = Math.max(maxY, h + 5);
    });
  }
  const mk = (B, mat, minY2, maxY2) => {
    if (!B.n) return null;
    const m = new THREE.Mesh(B.geometry(minY2, maxY2), mat);
    m.position.set(ox, 0, oz); m.frustumCulled = true; m.matrixAutoUpdate = false; m.updateMatrix();
    return m;
  };
  const out = [];
  const s = mk(S, gr.materials.solid, minY - 1, maxY + 8); if (s) { out.push(s); casters.push(s); s.layers.enable(1); }
  const w = mk(W, gr.materials.water, SEA_LEVEL, SEA_LEVEL + 1); if (w) out.push(w);
  return out;
}

// ---------- LOD tiles ----------
function surfaceInfo(x, z, h) {
  const r = hash(x >> 1, z >> 1);
  if (h <= SEA_LEVEL) return { c: [200, 190, 150], f: 8 };
  if (h > 112) return { c: [238, 244, 252], f: 2 };
  if (h > 98) return { c: [122, 120, 118], f: 4 };
  if (h <= SEA_LEVEL + 2) return { c: [218, 204, 156], f: 8 };
  if (r < 0.35) return { c: [52, 98, 44], f: 1 };
  return { c: [98 + r * 20, 148 + r * 16, 70], f: 0 };
}
function buildLod(L, tx, tz) {
  const e = 32 * (1 << L), cs = 1 << L, ox = tx * e, oz = tz * e;
  const pos = [], col = [], meta = [], idx = [];
  let n = 0;
  const hc = new Int16Array(34 * 34);
  const info = [];
  for (let j = -1; j <= 32; j++) for (let i = -1; i <= 32; i++) {
    const wx = ox + i * cs + cs / 2, wz = oz + j * cs + cs / 2;
    let h = H(Math.floor(wx), Math.floor(wz));
    const s = surfaceInfo(Math.floor(wx), Math.floor(wz), h);
    if (s.f === 1) h += Math.min(6, 2 + L);
    h -= Math.min(6, Math.ceil(0.25 * cs));
    hc[(j + 1) * 34 + i + 1] = h; info[(j + 1) * 34 + i + 1] = s;
  }
  const push = (v, c, shade, face, flags, hsh) => {
    pos.push(v[0], v[1], v[2]); col.push(c[0], c[1], c[2], Math.round(shade * 255)); meta.push(face, flags, hsh, L);
  };
  const quadv = (a, b, c, d, color, shade, face, flags, hsh) => {
    push(a, color, shade, face, flags, hsh); push(b, color, shade, face, flags, hsh); push(c, color, shade, face, flags, hsh); push(d, color, shade, face, flags, hsh);
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], fn = FN[face];
    const dp = (e1[1] * e2[2] - e1[2] * e2[1]) * fn[0] + (e1[2] * e2[0] - e1[0] * e2[2]) * fn[1] + (e1[0] * e2[1] - e1[1] * e2[0]) * fn[2];
    idx.push(...(dp < 0 ? [n, n + 2, n + 1, n, n + 3, n + 2] : [n, n + 1, n + 2, n, n + 2, n + 3])); n += 4;
  };
  const wpos = [], wcol = [], widx = []; let wn = 0;
  for (let j = 0; j < 32; j++) for (let i = 0; i < 32; i++) {
    const k = (j + 1) * 34 + i + 1, h = hc[k], s = info[k], x0 = i * cs, z0 = j * cs, hsh = Math.floor(hash(ox + i, oz + j) * 255);
    const base = h <= SEA_LEVEL ? 1 : 0;
    quadv([x0, h + 1, z0], [x0, h + 1, z0 + cs], [x0 + cs, h + 1, z0 + cs], [x0 + cs, h + 1, z0], s.c, 1, 2, s.f, hsh);
    const sides = [[1, 0, 0], [-1, 0, 1], [0, 1, 4], [0, -1, 5]];
    for (const [dx, dz, f] of sides) {
      const nh = hc[(j + 1 + dz) * 34 + i + 1 + dx];
      const edge = (i + dx < 0 || i + dx > 31 || j + dz < 0 || j + dz > 31);
      const lo = edge ? h + 1 - 2 * cs : nh + 1;
      if (lo >= h + 1) continue;
      const sc = s.f === 2 ? s.c : [118, 110, 100];
      let a, b, c, d;
      if (f === 0) { a = [x0 + cs, lo, z0]; b = [x0 + cs, lo, z0 + cs]; c = [x0 + cs, h + 1, z0 + cs]; d = [x0 + cs, h + 1, z0]; }
      else if (f === 1) { a = [x0, lo, z0 + cs]; b = [x0, lo, z0]; c = [x0, h + 1, z0]; d = [x0, h + 1, z0 + cs]; }
      else if (f === 4) { a = [x0 + cs, lo, z0 + cs]; b = [x0, lo, z0 + cs]; c = [x0, h + 1, z0 + cs]; d = [x0 + cs, h + 1, z0 + cs]; }
      else { a = [x0, lo, z0]; b = [x0 + cs, lo, z0]; c = [x0 + cs, h + 1, z0]; d = [x0, h + 1, z0]; }
      quadv(a, b, c, d, s.f === 0 || s.f === 1 ? (edge ? s.c : [120, 90, 64]) : sc, 0.85, f, s.f | 4 * (s.f === 0 ? 0 : 0), hsh);
    }
    if (base) {
      const y = SEA_LEVEL + WATER_TOP, dep = Math.min(SEA_LEVEL - h, 64) / 64;
      const wc = [60, 120, 200, Math.round(dep * 255)];
      for (const v of [[x0, z0], [x0, z0 + cs], [x0 + cs, z0 + cs], [x0 + cs, z0]]) { wpos.push(v[0], y, v[1]); wcol.push(...wc); }
      widx.push(wn, wn + 1, wn + 2, wn, wn + 2, wn + 3); wn += 4;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('aColor', new THREE.BufferAttribute(new Uint8Array(col), 4, true));
  g.setAttribute('aMeta', new THREE.BufferAttribute(new Uint8Array(meta), 4));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
  g.computeBoundingSphere(); g.computeBoundingBox();
  const m = new THREE.Mesh(g, gr.materials.lodSolid);
  m.position.set(ox, 0, oz); m.matrixAutoUpdate = false; m.updateMatrix();
  const out = [m];
  if (wn) {
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(wpos), 3));
    wg.setAttribute('aColor', new THREE.BufferAttribute(new Uint8Array(wcol), 4, true));
    wg.setAttribute('aMeta', new THREE.BufferAttribute(new Uint8Array(wn * 4), 4));
    wg.setIndex(new THREE.BufferAttribute(new Uint32Array(widx), 1));
    wg.computeBoundingSphere();
    const wm = new THREE.Mesh(wg, gr.materials.lodWater);
    wm.position.set(ox, 0, oz); wm.matrixAutoUpdate = false; wm.updateMatrix();
    out.push(wm);
  }
  return out;
}

const root = new THREE.Group(); gr.scene.add(root);
for (let cx = -1; cx <= 2; cx++) for (let cz = -1; cz <= 2; cz++) for (const m of buildChunk(cx, cz)) root.add(m);
// LOD rings around the chunk block [-32,96)^2
let cov = [-32, -32, 96, 96];
for (let Lv = 1; Lv <= 6; Lv++) {
  const e = 32 * (1 << Lv), r = 2;
  const x0 = Math.floor(cov[0] / e) - r, x1 = Math.ceil(cov[2] / e) + r, z0 = Math.floor(cov[1] / e) - r, z1 = Math.ceil(cov[3] / e) + r;
  for (let tx = x0; tx < x1; tx++) for (let tz = z0; tz < z1; tz++) {
    const inside = tx * e >= cov[0] && (tx + 1) * e <= cov[2] && tz * e >= cov[1] && (tz + 1) * e <= cov[3];
    if (inside) continue;
    for (const m of buildLod(Lv, tx, tz)) root.add(m);
  }
  cov = [Math.min(cov[0], x0 * e), Math.min(cov[1], z0 * e), Math.max(cov[2], x1 * e), Math.max(cov[3], z1 * e)];
}

const world = { getShadowCasters(c, r, out) { for (const m of casters) out.push(m); } };
let ang = +(P.get('ang') ?? 0.6), frames = 0;
const dist = +(P.get('dist') ?? 60), pitch = +(P.get('pitch') ?? -0.12), camY = +(P.get('y') ?? 82);
function frame() {
  const dt = 1 / 60;
  if (P.has('orbit')) ang += dt * 0.1;
  if (P.has('pos')) { const a = P.get('pos').split(',').map(Number), b = P.get('look').split(',').map(Number); gr.camera.position.set(a[0], a[1], a[2]); gr.camera.lookAt(b[0], b[1], b[2]); }
  else {
    gr.camera.position.set(32 + Math.cos(ang) * dist, camY, 32 + Math.sin(ang) * dist);
    gr.camera.lookAt(32, camY + pitch * dist - 6, 32);
  }
  gr.camera.updateMatrixWorld();
  gr.update(dt);
  gr.render(world);
  if (dbg) { gr.renderer.autoClear = false; gr.renderer.render(dbg, gr.camera); gr.renderer.autoClear = true; }
  if (++frames === 4) { window.__devReady = true; console.log('[HZ] dev ready', JSON.stringify(gr.info())); }
  requestAnimationFrame(frame);
}
let dbg = null;
if (P.has('dbgmap')) {
  const m = new THREE.ShaderMaterial({ uniforms: { t: gr.shared.uShadowMap }, vertexShader: 'varying vec2 vUv; void main(){ vUv = position.xy*0.5+0.5; gl_Position = vec4(position.xy*0.5-0.5+vec2(0.5,0.5)*0.0 - vec2(0.5,-0.5)*0.0, 0.0, 1.0); gl_Position.xy = position.xy*0.45 + vec2(-0.5, 0.5); }', fragmentShader: 'uniform sampler2D t; varying vec2 vUv; void main(){ float d = texture(t, vUv).r; gl_FragColor = vec4(vec3(fract(d*20.0)), 1.0); }', depthTest: false });
  const g = new THREE.PlaneGeometry(2, 2); const q = new THREE.Mesh(g, m); q.frustumCulled = false;
  dbg = new THREE.Scene(); dbg.add(q);
}
window.__dbg = () => dbg;
window.__gr = gr; window.__THREE = THREE;
frame();
