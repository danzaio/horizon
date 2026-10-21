// Greedy mesher for padded chunk volumes -> contract §2a vertex format (aPos u16x4, aMeta u8x4, aTint u8x4 normalized, index).
import { B, TILE_FACE, RENDER, OPAQUE, CUTOUT, SOLID, LIQUID, TINT, EMIT, SWAY, WATERLOGGED } from '../shared/blocks.js';
import { META_AO_SHIFT, META_SWAY, META_CUTOUT, META_EMISSIVE, WATER_TOP, CHUNK_VOLUME } from '../shared/constants.js';
import { TINT_TABLE } from './terrain.js';
import { macroNoise } from './noise.js';
import { PS, PSY, LIGHT_BLOCK } from './chunkGen.js';

const LEAF = new Uint8Array(256);
for (let i = 0; i < 256; i++) LEAF[i] = (CUTOUT[i] && SOLID[i] && i !== B.GLASS) ? 1 : 0;
// per tile layer flags
const LAYER_FLAGS = new Uint8Array(256);
for (let id = 1; id < 255; id++) {
  if (!RENDER[id] || RENDER[id] === 3) continue;
  const fl = (SWAY[id] ? META_SWAY : 0) | (CUTOUT[id] ? META_CUTOUT : 0) | (EMIT[id] ? META_EMISSIVE : 0);
  for (let f = 0; f < 6; f++) LAYER_FLAGS[TILE_FACE[id * 6 + f]] |= fl;
}
const N_OFF = [1, -1, PSY, -PSY, PS, -PS];
const D_COL = [1, -1, 0, 0, PS, -PS];
const D_Y = [0, 0, 1, -1, 0, 0];
const FLIP = [1, 0, 1, 0, 0, 1];
// per face: u stride, v stride in padded index
const U_STR = [PS, PS, 1, 1, 1, 1];
const V_STR = [PSY, PSY, PS, PS, PSY, PSY];

class Buf {
  // macro-variation state (set per chunk by Mesher.mesh): world origin of the chunk interior
  get macroReady() { return this.macro; }
  constructor(cap) {
    this.cap = cap; this.pos = new Uint16Array(cap * 4); this.meta = new Uint8Array(cap * 4); this.tint = new Uint8Array(cap * 4);
    this.idx = new Uint32Array(cap * 3 / 2 | 0); this.nv = 0; this.ni = 0; this.minY = 1e9; this.maxY = -1e9;
  }
  reset() { this.nv = 0; this.ni = 0; this.minY = 1e9; this.maxY = -1e9; }
  ensure(addV) {
    if (this.nv + addV <= this.cap) return;
    let cap = this.cap * 2; while (cap < this.nv + addV) cap *= 2;
    const p = new Uint16Array(cap * 4); p.set(this.pos); this.pos = p;
    const m = new Uint8Array(cap * 4); m.set(this.meta); this.meta = m;
    const t = new Uint8Array(cap * 4); t.set(this.tint); this.tint = t;
    const ix = new Uint32Array(cap * 3 / 2 | 0); ix.set(this.idx); this.idx = ix;
    this.cap = cap;
  }
  vert(x, y, z, layer, m0, m1, m2, m3, tr, tg, tb, ta) {
    if (this.macro && ta === 255 && (tr < 255 || tg < 255 || tb < 255)) {
      // biome tint gets a smooth per-position variation (luminance + a slight yellow-green <-> blue-green drift): meadows and canopies stop reading as one flat colour
      const wx = this.ox + x * 0.0625, wz = this.oz + z * 0.0625;
      const f = 1 + (macroNoise(wx, wz) - 0.5) * 0.24, hue = (macroNoise(wx + 91, wz - 53) - 0.5) * 0.12;
      tr = tr * (f - hue); tg = tg * f; tb = tb * (f + hue * 0.7);
      tr = tr > 255 ? 255 : tr; tg = tg > 255 ? 255 : tg; tb = tb > 255 ? 255 : tb;
    }
    const o = this.nv * 4, p = this.pos, m = this.meta, t = this.tint;
    p[o] = x; p[o + 1] = y; p[o + 2] = z; p[o + 3] = layer;
    m[o] = m0; m[o + 1] = m1; m[o + 2] = m2; m[o + 3] = m3;
    t[o] = tr; t[o + 1] = tg; t[o + 2] = tb; t[o + 3] = ta;
    if (y < this.minY) this.minY = y; if (y > this.maxY) this.maxY = y;
    this.nv++;
  }
  tri(a, b, c) { const i = this.idx, n = this.ni, v = this.nv - 4; i[n] = v + a; i[n + 1] = v + b; i[n + 2] = v + c; this.ni = n + 3; }
  /** two triangles of the last 4 vertices; diag=0: p00-p11, diag=1: p10-p01; flip reverses winding */
  quadIdx(diag, flip) {
    if (!diag) { if (!flip) { this.tri(0, 1, 2); this.tri(0, 2, 3); } else { this.tri(2, 1, 0); this.tri(3, 2, 0); } }
    else if (!flip) { this.tri(1, 2, 3); this.tri(1, 3, 0); } else { this.tri(3, 2, 1); this.tri(0, 3, 1); }
  }
  finish() {
    if (this.nv === 0) return null;
    const nv = this.nv;
    const index = nv < 65535 ? new Uint16Array(this.ni) : new Uint32Array(this.ni);
    index.set(this.idx.subarray(0, this.ni));
    return {
      aPos: this.pos.slice(0, nv * 4), aMeta: this.meta.slice(0, nv * 4), aTint: this.tint.slice(0, nv * 4), index,
      minY: this.minY / 16, maxY: this.maxY / 16, tris: this.ni / 3,
    };
  }
}

export class Mesher {
  constructor() {
    this.mask = new Int32Array(CHUNK_VOLUME);
    this.solid = new Buf(8192);
    this.water = new Buf(2048);
    this.gen = null;
  }

  sky1(ci, y) {
    const g = this.gen, to = g.topO[ci];
    let l = 15;
    if (to > y) l -= to - y;
    const tw = g.topW[ci];
    if (tw > y && tw > to) l -= (tw - y) >> 1;
    return l < 0 ? 0 : l;
  }

  skyAt(ci, y) {
    let l = this.sky1(ci, y);
    if (l < 15 && !this.gen.edge[ci]) {
      let t = this.sky1(ci - 1, y) - 2; if (t > l) l = t;
      t = this.sky1(ci + 1, y) - 2; if (t > l) l = t;
      t = this.sky1(ci - PS, y) - 2; if (t > l) l = t;
      t = this.sky1(ci + PS, y) - 2; if (t > l) l = t;
    }
    return l;
  }

  /**
   * Mesh a generated ChunkGen volume.
   * @param {import('./chunkGen.js').ChunkGen} gen
   * @returns {{solid:object|null, water:object|null}}
   */
  mesh(gen) {
    this.gen = gen;
    this.solid.reset(); this.water.reset();
    this.solid.macro = true; this.solid.ox = gen.wx0 + 1; this.solid.oz = gen.wz0 + 1; this.water.macro = false;
    this.meshCubes();
    this.meshCross();
    this.meshWater();
    return { solid: this.solid.finish(), water: this.water.finish() };
  }

  meshCubes() {
    const g = this.gen, vol = g.vol, mask = this.mask, bio = g.bio, bl = g.bl, hasBL = g.hasBlockLight, layerCount = g.layerCount, topS = g.topS;
    const y0 = g.yMin, y1 = g.yMax;
    for (let f = 0; f < 6; f++) {
      const nOff = N_OFF[f], su = U_STR[f], sv = V_STR[f], dcol = D_COL[f], dy = D_Y[f];
      let any = false;
      for (let y = y0; y <= y1; y++) {
        if (!layerCount[y]) continue;
        const prow = (y + 1) * PSY;
        for (let z = 0; z < 32; z++) {
          let col = (z + 1) * PS + 1, pi = prow + col, mi = y * 1024 + z * 32;
          for (let x = 0; x < 32; x++, pi++, mi++, col++) {
            const b = vol[pi];
            if (b === 0 || RENDER[b] !== 1) continue;
            const q = pi + nOff, nb = vol[q];
            let seam = false;
            if (OPAQUE[nb]) {
              // chunk-border faces near the surface stay visible so no sliver shows between this chunk and a lower LOD tile
              if (f < 2 ? (x === (f ? 0 : 31)) : (f > 3 && z === (f === 4 ? 31 : 0))) { if (OPAQUE[b] && y >= topS[col + dcol] - 3) seam = true; else continue; }
              else continue;
            } else {
              if (nb === b && !OPAQUE[b]) continue;
              if (LEAF[b] && LEAF[nb]) continue;
            }
            // ambient occlusion
            let c00 = 3, c10 = 3, c11 = 3, c01 = 3;
            if (!seam) {
              const om = LIGHT_BLOCK[vol[q - su]], op = LIGHT_BLOCK[vol[q + su]], vm = LIGHT_BLOCK[vol[q - sv]], vp = LIGHT_BLOCK[vol[q + sv]];
              c00 = (om && vm) ? 0 : 3 - (om + vm + LIGHT_BLOCK[vol[q - su - sv]]);
              c10 = (op && vm) ? 0 : 3 - (op + vm + LIGHT_BLOCK[vol[q + su - sv]]);
              c11 = (op && vp) ? 0 : 3 - (op + vp + LIGHT_BLOCK[vol[q + su + sv]]);
              c01 = (om && vp) ? 0 : 3 - (om + vp + LIGHT_BLOCK[vol[q - su + sv]]);
            }
            const layer = TILE_FACE[b * 6 + f];
            let light;
            if (EMIT[b]) light = 255;
            else if (seam) light = this.skyAt(col, y) << 4;
            else {
              light = this.skyAt(col + dcol, y + dy) << 4;
              if (hasBL) light |= bl[q];
            }
            const tt = TINT[b];
            const ti = tt ? bio[col] * 4 + tt : 0;
            mask[mi] = layer | (c00 | c10 << 2 | c11 << 4 | c01 << 6) << 7 | light << 15 | ti << 23 | (1 << 29);
            any = true;
          }
        }
      }
      if (any) this.greedy(f, y0, y1);
    }
  }

  greedy(f, y0, y1) {
    const mask = this.mask;
    let sLo, sHi, sS, uS, vS, vLo, vHi;
    if (f < 2) { sLo = 0; sHi = 31; sS = 1; uS = 32; vS = 1024; vLo = y0; vHi = y1; }
    else if (f < 4) { sLo = y0; sHi = y1; sS = 1024; uS = 1; vS = 32; vLo = 0; vHi = 31; }
    else { sLo = 0; sHi = 31; sS = 32; uS = 1; vS = 1024; vLo = y0; vHi = y1; }
    for (let s = sLo; s <= sHi; s++) {
      for (let v = vLo; v <= vHi; v++) {
        for (let u = 0; u < 32; u++) {
          const mi = s * sS + v * vS + u * uS, key = mask[mi];
          if (!key) continue;
          const ao = (key >> 7) & 255, c00 = ao & 3, c10 = (ao >> 2) & 3, c11 = (ao >> 4) & 3, c01 = (ao >> 6) & 3;
          let w = 1, h = 1;
          if (c00 === c10 && c01 === c11) while (u + w < 32 && mask[mi + w * uS] === key) w++;
          if (c00 === c01 && c10 === c11) {
            outer: while (v + h <= vHi) {
              const row = mi + h * vS;
              for (let k = 0; k < w; k++) if (mask[row + k * uS] !== key) break outer;
              h++;
            }
          }
          for (let hh = 0; hh < h; hh++) { const row = mi + hh * vS; for (let ww = 0; ww < w; ww++) mask[row + ww * uS] = 0; }
          this.quad(f, s, u, v, w, h, key);
        }
      }
    }
  }

  quad(f, s, u, v, w, h, key) {
    const buf = this.solid; buf.ensure(4);
    const layer = key & 127, ao = (key >> 7) & 255, light = (key >> 15) & 255, ti = (key >> 23) & 63;
    const a0 = ao & 3, a1 = (ao >> 2) & 3, a2 = (ao >> 4) & 3, a3 = (ao >> 6) & 3;
    const fl = LAYER_FLAGS[layer];
    const tr = ti ? TINT_TABLE[ti * 3] : 255, tg = ti ? TINT_TABLE[ti * 3 + 1] : 255, tb = ti ? TINT_TABLE[ti * 3 + 2] : 255;
    const sPos = ((f & 1) ? s : s + 1) * 16;
    const u0 = u * 16, u1 = (u + w) * 16, v0 = v * 16, v1 = (v + h) * 16;
    for (let k = 0; k < 4; k++) {
      const hi = k === 1 || k === 2, vh = k >= 2;
      const A = hi ? u1 : u0, Bv = vh ? v1 : v0;
      const m0 = f | (k === 0 ? a0 : k === 1 ? a1 : k === 2 ? a2 : a3) << META_AO_SHIFT | fl, mu = hi ? w : 0, mv = vh ? h : 0;
      if (f < 2) buf.vert(sPos, Bv, A, layer, m0, mu, mv, light, tr, tg, tb, 255);
      else if (f < 4) buf.vert(A, sPos, Bv, layer, m0, mu, mv, light, tr, tg, tb, 255);
      else buf.vert(A, Bv, sPos, layer, m0, mu, mv, light, tr, tg, tb, 255);
    }
    buf.quadIdx(a0 + a2 > a1 + a3 ? 1 : 0, FLIP[f]);
  }

  meshCross() {
    const g = this.gen, vol = g.vol, buf = this.solid, bio = g.bio, bl = g.bl, hasBL = g.hasBlockLight;
    for (let y = g.yMin; y <= g.yMax; y++) {
      if (!g.layerCount[y]) continue;
      const prow = (y + 1) * PSY;
      for (let z = 0; z < 32; z++) {
        let col = (z + 1) * PS + 1, pi = prow + col;
        for (let x = 0; x < 32; x++, pi++, col++) {
          const b = vol[pi];
          if (b === 0 || RENDER[b] !== 2) continue;
          buf.ensure(8);
          const layer = TILE_FACE[b * 6];
          const light = (this.skyAt(col, y) << 4) | (hasBL ? bl[pi] : 0);
          const tt = TINT[b], ti = tt ? bio[col] * 4 + tt : 0;
          const tr = ti ? TINT_TABLE[ti * 3] : 255, tg = ti ? TINT_TABLE[ti * 3 + 1] : 255, tb = ti ? TINT_TABLE[ti * 3 + 2] : 255;
          const m0 = 6 | 3 << META_AO_SHIFT | LAYER_FLAGS[layer];
          const X = x * 16, Y = y * 16, Z = z * 16;
          for (let d = 0; d < 2; d++) {
            // diagonal d=0: (x,z)->(x+1,z+1), d=1: (x+1,z)->(x,z+1)
            const ax = d ? X + 16 : X, bx = d ? X : X + 16;
            buf.vert(ax, Y, Z, layer, m0, 0, 0, light, tr, tg, tb, 255);
            buf.vert(bx, Y, Z + 16, layer, m0, 1, 0, light, tr, tg, tb, 255);
            buf.vert(bx, Y + 16, Z + 16, layer, m0, 1, 1, light, tr, tg, tb, 255);
            buf.vert(ax, Y + 16, Z, layer, m0, 0, 1, light, tr, tg, tb, 255);
            buf.quadIdx(0, 0);
            const n = buf.ni; // back face: same vertices, reversed winding
            const v = buf.nv - 4;
            buf.idx[n] = v + 2; buf.idx[n + 1] = v + 1; buf.idx[n + 2] = v; buf.idx[n + 3] = v + 3; buf.idx[n + 4] = v + 2; buf.idx[n + 5] = v; buf.ni = n + 6;
          }
        }
      }
    }
  }

  meshWater() {
    const g = this.gen, vol = g.vol, buf = this.water, mask = this.mask, bio = g.bio;
    let wy0 = 999, wy1 = -1;
    for (let z = 0; z < 32; z++) for (let x = 0; x < 32; x++) {
      const col = (x + 1) + (z + 1) * PS, tw = g.topW[col];
      if (tw >= 0) { if (tw > wy1) wy1 = tw; if (g.sy[col] + 1 < wy0) wy0 = Math.max(0, g.sy[col] + 1); }
    }
    if (wy1 < 0) return;
    let anyTop = false;
    const nbr = [1, -1, PS, -PS];
    for (let y = wy0; y <= wy1; y++) {
      const prow = (y + 1) * PSY;
      for (let z = 0; z < 32; z++) {
        let col = (z + 1) * PS + 1, pi = prow + col, mi = y * 1024 + z * 32;
        for (let x = 0; x < 32; x++, pi++, mi++, col++) {
          if (vol[pi] !== B.WATER) continue;
          const ab = vol[pi + PSY], ti = bio[col] * 4 + 3;
          const topFree = ab !== B.WATER && !OPAQUE[ab];
          if (topFree) {
            let n = 1; while (n < 16 && vol[pi - n * PSY] === B.WATER) n++;
            const sky = this.skyAt(col, y + 1);
            mask[mi] = n | sky << 5 | ti << 13 | (1 << 29);
            anyTop = true;
          }
          // side / bottom faces against non-water, non-opaque neighbours (rare: edits, cave openings)
          for (let d = 0; d < 4; d++) {
            const nv = vol[pi + nbr[d]];
            if (nv === B.WATER || OPAQUE[nv] || WATERLOGGED[nv]) continue;
            this.waterSide(d < 2 ? (d ? 1 : 0) : (d === 2 ? 4 : 5), x, y, z, ab === B.WATER ? 16 : 14, ti, this.skyAt(col + nbr[d], y) << 4);
          }
          const bv = vol[pi - PSY];
          if (bv !== B.WATER && !OPAQUE[bv] && !WATERLOGGED[bv]) this.waterSide(3, x, y, z, 0, ti, this.skyAt(col, y) << 4);
        }
      }
    }
    if (!anyTop) return;
    for (let y = wy0; y <= wy1; y++) {
      for (let z = 0; z < 32; z++) {
        for (let x = 0; x < 32; x++) {
          const mi = y * 1024 + z * 32 + x, key = mask[mi];
          if (!key) continue;
          let w = 1, h = 1;
          while (x + w < 32 && mask[mi + w] === key) w++;
          outer: while (z + h < 32) {
            const row = mi + h * 32;
            for (let k = 0; k < w; k++) if (mask[row + k] !== key) break outer;
            h++;
          }
          for (let hh = 0; hh < h; hh++) { const row = mi + hh * 32; for (let ww = 0; ww < w; ww++) mask[row + ww] = 0; }
          buf.ensure(4);
          const dq = key & 31, sky = (key >> 5) & 15, ti = (key >> 13) & 63;
          const light = sky << 4, tr = TINT_TABLE[ti * 3], tg = TINT_TABLE[ti * 3 + 1], tb = TINT_TABLE[ti * 3 + 2];
          const ta = Math.round(Math.min(dq, 16) / 16 * 255);
          const yy = y * 16 + 14, m0 = 2 | 3 << META_AO_SHIFT;
          const x0 = x * 16, x1 = (x + w) * 16, z0 = z * 16, z1 = (z + h) * 16;
          buf.vert(x0, yy, z0, 0, m0, 0, 0, light, tr, tg, tb, ta);
          buf.vert(x1, yy, z0, 0, m0, 1, 0, light, tr, tg, tb, ta);
          buf.vert(x1, yy, z1, 0, m0, 1, 1, light, tr, tg, tb, ta);
          buf.vert(x0, yy, z1, 0, m0, 0, 1, light, tr, tg, tb, ta);
          buf.quadIdx(0, 1);
        }
      }
    }
  }

  /** single water side quad (face f), top at topSixteenths within the block */
  waterSide(f, x, y, z, top16, ti, light) {
    const buf = this.water; buf.ensure(4);
    const tr = TINT_TABLE[ti * 3], tg = TINT_TABLE[ti * 3 + 1], tb = TINT_TABLE[ti * 3 + 2];
    const m0 = f | 3 << META_AO_SHIFT, X = x * 16, Y = y * 16, Z = z * 16;
    const yt = f === 3 ? Y : Y + top16;
    if (f === 0 || f === 1) {
      const xx = f === 0 ? X + 16 : X;
      buf.vert(xx, Y, Z, 0, m0, 0, 0, light, tr, tg, tb, 255); buf.vert(xx, Y, Z + 16, 0, m0, 1, 0, light, tr, tg, tb, 255);
      buf.vert(xx, yt, Z + 16, 0, m0, 1, 1, light, tr, tg, tb, 255); buf.vert(xx, yt, Z, 0, m0, 0, 1, light, tr, tg, tb, 255);
    } else if (f === 4 || f === 5) {
      const zz = f === 4 ? Z + 16 : Z;
      buf.vert(X, Y, zz, 0, m0, 0, 0, light, tr, tg, tb, 255); buf.vert(X + 16, Y, zz, 0, m0, 1, 0, light, tr, tg, tb, 255);
      buf.vert(X + 16, yt, zz, 0, m0, 1, 1, light, tr, tg, tb, 255); buf.vert(X, yt, zz, 0, m0, 0, 1, light, tr, tg, tb, 255);
    } else {
      buf.vert(X, Y, Z, 0, m0, 0, 0, light, tr, tg, tb, 255); buf.vert(X + 16, Y, Z, 0, m0, 1, 0, light, tr, tg, tb, 255);
      buf.vert(X + 16, Y, Z + 16, 0, m0, 1, 1, light, tr, tg, tb, 255); buf.vert(X, Y, Z + 16, 0, m0, 0, 1, light, tr, tg, tb, 255);
    }
    buf.quadIdx(0, FLIP[f]);
  }
}
