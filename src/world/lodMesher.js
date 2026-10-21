// LOD tile builder (contract §2b): stepped-column mesh sampled from the SAME terrain functions with fewer octaves.
import { SEA_LEVEL, WATER_TOP, LODF_CANOPY, LODF_SNOW, LODF_CLIFF, LODF_SAND, LODF_WATER } from '../shared/constants.js';
import { BIOME, TINT_TABLE, TREE_DENSITY } from './terrain.js';
import { hash3, macroNoise } from './noise.js';

const G = 34;
const OCT = [9, 6, 5, 5, 4, 3, 3, 2, 1, 1];
const SMOOTH_L = 5; // levels >= this use a sloped (vertex-height) surface: silhouettes read as terrain, not buildings
const QH = [1, 1, 1, 2, 2, 4, 4, 8, 12, 16];
const smooth = (a, b, x) => { const t = x < a ? 0 : x > b ? 1 : (x - a) / (b - a); return t * t * (3 - 2 * t); };
const ROCK = [118, 116, 114];
const LEAF = { [BIOME.FOREST]: [54, 108, 40], [BIOME.BIRCH]: [100, 138, 62], [BIOME.TAIGA]: [40, 80, 52], [BIOME.SNOWY]: [44, 84, 56], [BIOME.SWAMP]: [58, 88, 50], [BIOME.STONY]: [44, 82, 54], [BIOME.SAVANNA]: [120, 130, 56], [BIOME.PLAINS]: [66, 120, 44], [BIOME.CHERRY]: [236, 150, 188] };
// clay strata colours (same period-16 pattern as chunkGen STRATA)
const BAND = [[182, 98, 56], [182, 98, 56], [206, 160, 78], [152, 64, 48], [182, 98, 56], [210, 186, 168], [182, 98, 56], [112, 74, 56], [182, 98, 56], [206, 160, 78], [182, 98, 56], [182, 98, 56], [152, 64, 48], [210, 186, 168], [182, 98, 56], [112, 74, 56]];
const TREE_H = { [BIOME.FOREST]: 6, [BIOME.BIRCH]: 6.5, [BIOME.TAIGA]: 8, [BIOME.SNOWY]: 7, [BIOME.SWAMP]: 5, [BIOME.STONY]: 7, [BIOME.SAVANNA]: 5, [BIOME.PLAINS]: 5, [BIOME.CHERRY]: 5.5 };

class LBuf {
  constructor(cap) { this.alloc(cap); this.nv = 0; this.ni = 0; this.minY = 1e9; this.maxY = -1e9; }
  alloc(cap) { this.cap = cap; this.pos = new Float32Array(cap * 3); this.col = new Uint8Array(cap * 4); this.meta = new Uint8Array(cap * 4); this.idx = new Uint16Array(cap * 3 / 2 | 0); }
  reset() { this.nv = 0; this.ni = 0; this.minY = 1e9; this.maxY = -1e9; }
  ensure(n) {
    if (this.nv + n <= this.cap) return;
    const o = { pos: this.pos, col: this.col, meta: this.meta, idx: this.idx, nv: this.nv, ni: this.ni };
    this.alloc(Math.min(65532, this.cap * 2));
    this.pos.set(o.pos); this.col.set(o.col); this.meta.set(o.meta); this.idx.set(o.idx);
  }
  v(x, y, z, r, g, b, a, m0, m1, m2, m3) {
    const n = this.nv++, p = n * 3, c = n * 4;
    this.pos[p] = x; this.pos[p + 1] = y; this.pos[p + 2] = z;
    this.col[c] = r; this.col[c + 1] = g; this.col[c + 2] = b; this.col[c + 3] = a;
    this.meta[c] = m0; this.meta[c + 1] = m1; this.meta[c + 2] = m2; this.meta[c + 3] = m3;
    if (y < this.minY) this.minY = y; if (y > this.maxY) this.maxY = y;
  }
  /** indices of the last 4 vertices: (0,1,2),(0,2,3) */
  quad() { const v = this.nv - 4, i = this.idx, n = this.ni; i[n] = v; i[n + 1] = v + 1; i[n + 2] = v + 2; i[n + 3] = v; i[n + 4] = v + 2; i[n + 5] = v + 3; this.ni = n + 6; }
  finish() {
    if (!this.nv) return null;
    return { position: this.pos.slice(0, this.nv * 3), aColor: this.col.slice(0, this.nv * 4), aMeta: this.meta.slice(0, this.nv * 4), index: this.idx.slice(0, this.ni), minY: this.minY, maxY: this.maxY, tris: this.ni / 3 };
  }
}

export class LodMesher {
  /** @param {ReturnType<import('./terrain.js').createTerrain>} terrain */
  constructor(terrain) {
    this.terrain = terrain;
    this.info = { h: 0, biome: 0, temp: 0, hum: 0, mask: 0, river: 1, snow: 0 };
    const N = G * G;
    this.H = new Int16Array(N); this.sy = new Int16Array(N); this.R = new Uint8Array(N); this.Gc = new Uint8Array(N); this.Bc = new Uint8Array(N);
    this.HP = new Float32Array(N); this.CH = new Float32Array(33 * 33); this.HF = new Float32Array(N); this.HT = new Float32Array(N); this.SN = new Float32Array(N);
    this.WR = new Uint8Array(N); this.WG = new Uint8Array(N); this.WB = new Uint8Array(N);
    this.FL = new Uint8Array(N); this.HS = new Uint8Array(N); this.BI = new Uint8Array(N); this.WD = new Uint8Array(N);
    this.solid = new LBuf(8192); this.water = new LBuf(2048);
  }

  /**
   * Build tile (L, tx, tz): returns {solid, water} (either may be null).
   * @param {number} L level 1..9
   */
  build(L, tx, tz) {
    const c = 1 << L, edge = 32 * c, ox = tx * edge, oz = tz * edge;
    const T = this.terrain, info = this.info, oct = OCT[L] || 1;
    const { H, sy, R, Gc, Bc, WR, WG, WB, FL, HS, BI, WD } = this;
    const bias = Math.min(6, 0.25 * c);
    const nz = T.noise2, seedT = T.seed;
    // ---- pass 1: sample 34x34 grid (1-cell border): float height, biome, snow
    const { HF, SN } = this;
    for (let cj = -1; cj <= 32; cj++) {
      for (let ci = -1; ci <= 32; ci++) {
        const k = (cj + 1) * G + ci + 1;
        const wx = ox + (ci + 0.5) * c, wz = oz + (cj + 0.5) * c;
        T.columnInfo(wx, wz, oct, info);
        let hAvg = info.h;
        if (L >= 8) {
          // coarse cells: average a 3x3 supersample so sharp ridges don't alias into 'skyscraper' columns
          const o = c / 3;
          let sum = 0;
          for (let sj = -1; sj <= 1; sj++) for (let si = -1; si <= 1; si++) sum += T.heightAt(wx + si * o, wz + sj * o, oct);
          hAvg = sum / 9;
        }
        HF[k] = hAvg; BI[k] = info.biome; SN[k] = info.snow;
      }
    }
    if (L >= 3) {
      // smooth [1 2 1] blur so isolated ridge samples become rounded hills instead of towers
      const tmp = this.HT;
      for (let cj = 0; cj < G; cj++) for (let ci = 0; ci < G; ci++) {
        const k = cj * G + ci, l = ci > 0 ? k - 1 : k, r2 = ci < G - 1 ? k + 1 : k;
        tmp[k] = (HF[l] + 2 * HF[k] + HF[r2]) * 0.25;
      }
      for (let cj = 0; cj < G; cj++) for (let ci = 0; ci < G; ci++) {
        const k = cj * G + ci, u = cj > 0 ? k - G : k, d2 = cj < G - 1 ? k + G : k;
        HF[k] = (tmp[u] + 2 * tmp[k] + tmp[d2]) * 0.25;
      }
    }
    // ---- pass 2: colours + planes
    for (let cj = -1; cj <= 32; cj++) {
      for (let ci = -1; ci <= 32; ci++) {
        const k = (cj + 1) * G + ci + 1;
        const wx = ox + (ci + 0.5) * c, wz = oz + (cj + 0.5) * c;
        const s = Math.floor(HF[k]), b = BI[k];
        sy[k] = s;
        const hs = hash3(tx * 32 + ci, L, tz * 32 + cj) & 255; HS[k] = hs;
        let fl = 0, r, g, bl;
        const wt = (b * 4 + 3) * 3;
        WR[k] = TINT_TABLE[wt]; WG[k] = TINT_TABLE[wt + 1]; WB[k] = TINT_TABLE[wt + 2];
        let plane;
        if (s < SEA_LEVEL) {
          fl = LODF_WATER;
          if (b === BIOME.RIVER && (hs & 7) < 5 || s >= 46) { r = 214; g = 200; bl = 150; fl |= LODF_SAND; } else { r = 128; g = 124; bl = 118; }
          plane = s + 1; WD[k] = Math.min(255, SEA_LEVEL - s);
        } else {
          WD[k] = 0;
          const gi = (b * 4 + 1) * 3;
          switch (b) {
            case BIOME.BEACH: r = 222; g = 208; bl = 160; fl |= LODF_SAND; break;
            case BIOME.BADLANDS: { const q = BAND[(s + 3 * (hash3(0, s >> 3, 31) & 3)) & 15]; r = q[0]; g = q[1]; bl = q[2]; if (s > SEA_LEVEL + 20) fl |= LODF_CLIFF; break; }
            case BIOME.DESERT: r = 226; g = 204; bl = 146; fl |= LODF_SAND; break;
            case BIOME.SNOWY: r = 238; g = 244; bl = 250; fl |= LODF_SNOW; break;
            case BIOME.TAIGA: r = 214; g = 230; bl = 226; fl |= LODF_SNOW; break;
            case BIOME.PEAKS:
              if (SN[k] > 0.7) { r = 244; g = 248; bl = 252; fl |= LODF_SNOW; } else { r = ROCK[0]; g = ROCK[1]; bl = ROCK[2]; fl |= LODF_CLIFF; }
              break;
            case BIOME.STONY:
              if ((hs & 15) < 6) { r = TINT_TABLE[gi] * 0.8; g = TINT_TABLE[gi + 1] * 0.8; bl = TINT_TABLE[gi + 2] * 0.8; } else { r = ROCK[0]; g = ROCK[1]; bl = ROCK[2]; fl |= LODF_CLIFF; }
              break;
            default: {   // grass-like: same macro variation the chunk meshes apply to their tint
              const f = 1 + (macroNoise(wx, wz) - 0.5) * 0.24, hue = (macroNoise(wx + 91, wz - 53) - 0.5) * 0.12;
              r = Math.min(255, TINT_TABLE[gi] * 0.82 * (f - hue)); g = Math.min(255, TINT_TABLE[gi + 1] * 0.82 * f); bl = Math.min(255, TINT_TABLE[gi + 2] * 0.82 * (f + hue * 0.7));
            }
          }
          plane = s + 1 - bias;
          // forest canopy: per-cell random trees at fine levels; smooth raise + colour blend at coarse levels (no 'skyscraper' columns)
          const dens = TREE_DENSITY[b];
          if (dens > 0) {
            let cover = dens * 1.6;
            if (b === BIOME.FOREST || b === BIOME.BIRCH || b === BIOME.TAIGA || b === BIOME.SWAMP || b === BIOME.CHERRY) cover *= 0.3 + 1.4 * smooth(-0.4, 0.4, nz.n2(wx * 0.007, wz * 0.007));
            if (cover > 0.9) cover = 0.9;
            const lc = LEAF[b] || LEAF[BIOME.FOREST], th = TREE_H[b] || 5;
            if (L <= 2) {
              // same deterministic 4x4 tree grid as chunkGen -> canopies line up with the real trees
              const gx0 = Math.floor(wx / 4), gz0 = Math.floor(wz / 4);
              let hit = false;
              for (let gz = gz0 - 1; gz <= gz0 + 1 && !hit; gz++) {
                for (let gx = gx0 - 1; gx <= gx0 + 1; gx++) {
                  const h = hash3(gx, gz, seedT + 4242), rr = (h & 0xffff) / 65536;
                  if (rr > 0.6) continue;
                  const ttx = gx * 4 + ((h >>> 16) & 3) + 0.5, ttz = gz * 4 + ((h >>> 18) & 3) + 0.5;
                  if (Math.abs(wx - ttx) > 2.4 || Math.abs(wz - ttz) > 2.4) continue;
                  let dn = dens;
                  if (b === BIOME.FOREST || b === BIOME.BIRCH || b === BIOME.TAIGA || b === BIOME.SWAMP || b === BIOME.CHERRY) dn *= 0.3 + 1.4 * smooth(-0.4, 0.4, nz.n2(ttx * 0.007, ttz * 0.007));
                  if (rr < dn) { hit = true; break; }
                }
              }
              if (hit) {
                const v = 0.82 + (hs & 31) / 150;
                r = lc[0] * v; g = lc[1] * v; bl = lc[2] * v; fl = LODF_CANOPY | (fl & LODF_SNOW);
                plane += th;
              }
            } else if (cover > 0.12) {
              const m = Math.min(1, cover * 1.25);
              r += (lc[0] * 0.9 - r) * m; g += (lc[1] * 0.9 - g) * m; bl += (lc[2] * 0.9 - bl) * m;
              plane += th * cover * 0.6;
              if (cover > 0.35) fl = LODF_CANOPY | (fl & LODF_SNOW);
            }
          }
        }
        R[k] = r; Gc[k] = g; Bc[k] = bl;
        FL[k] = fl;
        const smoothL = L >= SMOOTH_L, Q = smoothL ? 1 : (QH[L] || 8);
        let pi = Math.floor(plane / Q) * Q;
        if (s >= SEA_LEVEL && pi < SEA_LEVEL + 1 && !(fl & LODF_CANOPY)) pi = SEA_LEVEL + 1;
        H[k] = pi < 1 ? 1 : pi;
        if (smoothL) { let pf = plane; if (s >= SEA_LEVEL && pf < SEA_LEVEL + 1 && !(fl & LODF_CANOPY)) pf = SEA_LEVEL + 1; this.HP[k] = pf < 1 ? 1 : pf; }
      }
    }
    // cliff flag from slope
    for (let cj = 0; cj < 32; cj++) {
      for (let ci = 0; ci < 32; ci++) {
        const k = (cj + 1) * G + ci + 1, h = H[k];
        const d = Math.max(Math.abs(h - H[k - 1]), Math.abs(h - H[k + 1]), Math.abs(h - H[k - G]), Math.abs(h - H[k + G]));
        if (d > c * 1.3 + 1 && !(FL[k] & (LODF_WATER | LODF_CANOPY))) {
          FL[k] |= LODF_CLIFF;
          if (!(FL[k] & LODF_SNOW) || d > c * 2.6) { R[k] = ROCK[0]; Gc[k] = ROCK[1]; Bc[k] = ROCK[2]; FL[k] &= ~LODF_SNOW; }
        }
      }
    }
    const S = this.solid, W = this.water;
    S.reset(); W.reset();
    const skirt = Math.max(4, 2 * c);
    // ---- top faces (x-run merged) + water surfaces
    const sloped = L >= SMOOTH_L, CH = this.CH, HP = this.HP;
    if (sloped) {
      for (let b = 0; b < 33; b++) for (let a = 0; a < 33; a++) { const k = b * G + a; CH[b * 33 + a] = (HP[k] + HP[k + 1] + HP[k + G] + HP[k + G + 1]) * 0.25; }
    }
    for (let cj = 0; cj < 32; cj++) {
      let ci = 0;
      if (sloped) {
        for (; ci < 32; ci++) {
          const k = (cj + 1) * G + ci + 1, x0 = ci * c, x1 = x0 + c, z0 = cj * c, z1 = z0 + c, fl = FL[k], hs = HS[k];
          const h00 = CH[cj * 33 + ci], h10 = CH[cj * 33 + ci + 1], h01 = CH[(cj + 1) * 33 + ci], h11 = CH[(cj + 1) * 33 + ci + 1];
          S.ensure(4);
          S.v(x0, h00, z0, R[k], Gc[k], Bc[k], 255, 2, fl, hs, L);
          S.v(x0, h01, z1, R[k], Gc[k], Bc[k], 255, 2, fl, hs, L);
          S.v(x1, h11, z1, R[k], Gc[k], Bc[k], 255, 2, fl, hs, L);
          S.v(x1, h10, z0, R[k], Gc[k], Bc[k], 255, 2, fl, hs, L);
          S.quad();
        }
        ci = 32;
      }
      while (ci < 32) {
        const k = (cj + 1) * G + ci + 1;
        let n = 1;
        while (ci + n < 32) {
          const k2 = k + n;
          if (H[k2] !== H[k] || R[k2] !== R[k] || Gc[k2] !== Gc[k] || Bc[k2] !== Bc[k] || FL[k2] !== FL[k]) break;
          n++;
        }
        S.ensure(4);
        const x0 = ci * c, x1 = (ci + n) * c, z0 = cj * c, z1 = z0 + c, y = H[k], fl = FL[k];
        S.v(x0, y, z0, R[k], Gc[k], Bc[k], 255, 2, fl, HS[k], L);
        S.v(x0, y, z1, R[k], Gc[k], Bc[k], 255, 2, fl, HS[k], L);
        S.v(x1, y, z1, R[k], Gc[k], Bc[k], 255, 2, fl, HS[k], L);
        S.v(x1, y, z0, R[k], Gc[k], Bc[k], 255, 2, fl, HS[k], L);
        S.quad();
        ci += n;
      }
      // water runs
      ci = 0;
      while (ci < 32) {
        const k = (cj + 1) * G + ci + 1;
        if (!(FL[k] & LODF_WATER)) { ci++; continue; }
        const dq = Math.min(WD[k], 64) >> 2;
        let n = 1;
        while (ci + n < 32) {
          const k2 = k + n;
          if (!(FL[k2] & LODF_WATER) || (Math.min(WD[k2], 64) >> 2) !== dq || BI[k2] !== BI[k]) break;
          n++;
        }
        W.ensure(4);
        const x0 = ci * c, x1 = (ci + n) * c, z0 = cj * c, z1 = z0 + c, y = SEA_LEVEL + WATER_TOP, a = Math.round(dq * 4 / 64 * 255);
        W.v(x0, y, z0, WR[k], WG[k], WB[k], a, 2, LODF_WATER, HS[k], L);
        W.v(x0, y, z1, WR[k], WG[k], WB[k], a, 2, LODF_WATER, HS[k], L);
        W.v(x1, y, z1, WR[k], WG[k], WB[k], a, 2, LODF_WATER, HS[k], L);
        W.v(x1, y, z0, WR[k], WG[k], WB[k], a, 2, LODF_WATER, HS[k], L);
        W.quad();
        ci += n;
      }
    }
    if (sloped) {
      // perimeter skirts only (no interior walls): endpoints follow the smoothed corner heights so same-level tiles are watertight
      for (let cj = 0; cj < 32; cj++) {
        for (let ci = 0; ci < 32; ci++) {
          if (ci > 0 && ci < 31 && cj > 0 && cj < 31) continue;
          const k = (cj + 1) * G + ci + 1, x0 = ci * c, x1 = x0 + c, z0 = cj * c, z1 = z0 + c;
          if (ci === 31) this.skirtQ(S, 0, x1, z1, x1, z0, CH[(cj + 1) * 33 + 32], CH[cj * 33 + 32], skirt, k, L);
          if (ci === 0) this.skirtQ(S, 1, x0, z0, x0, z1, CH[cj * 33], CH[(cj + 1) * 33], skirt, k, L);
          if (cj === 31) this.skirtQ(S, 4, x0, z1, x1, z1, CH[32 * 33 + ci], CH[32 * 33 + ci + 1], skirt, k, L);
          if (cj === 0) this.skirtQ(S, 5, x1, z0, x0, z0, CH[ci + 1], CH[ci], skirt, k, L);
        }
      }
      return { solid: S.finish(), water: W.finish() };
    }
    // ---- side walls + perimeter skirts
    for (let cj = 0; cj < 32; cj++) {
      for (let ci = 0; ci < 32; ci++) {
        const k = (cj + 1) * G + ci + 1, h = H[k];
        for (let d = 0; d < 4; d++) {
          const kn = d === 0 ? k + 1 : d === 1 ? k - 1 : d === 2 ? k + G : k - G;
          const hn = H[kn];
          const perim = (d === 0 && ci === 31) || (d === 1 && ci === 0) || (d === 2 && cj === 31) || (d === 3 && cj === 0);
          let yb;
          if (perim) yb = Math.min(h, hn) - skirt;
          else if (hn < h) yb = hn; else continue;
          if (yb < 0) yb = 0;
          if (yb >= h) continue;
          this.wall(S, d, ci * c, cj * c, c, yb, h, k, h - yb, L, c);
        }
      }
    }
    return { solid: S.finish(), water: W.finish() };
  }

  /** perimeter skirt quad A=(ax,az) -> B=(bx,bz), top heights hA/hB, hanging `depth` below the lower one */
  skirtQ(S, face, ax, az, bx, bz, hA, hB, depth, k, L) {
    S.ensure(4);
    // Skirts only hide cracks between tiles of different levels: shade them like terrain (face 2 = lit as a top face, no dark
    // gradient, no cliff strata) so an exposed skirt reads as a continuation of the ground instead of a thin dark curtain.
    const yb = Math.max(0, Math.min(hA, hB) - depth), r = this.R[k] * 0.93, g = this.Gc[k] * 0.93, b = this.Bc[k] * 0.93, fl = this.FL[k] & ~LODF_CLIFF, hs = this.HS[k];
    S.v(ax, yb, az, r, g, b, 235, 2, fl, hs, L); S.v(bx, yb, bz, r, g, b, 235, 2, fl, hs, L);
    S.v(bx, hB, bz, r, g, b, 255, 2, fl, hs, L); S.v(ax, hA, az, r, g, b, 255, 2, fl, hs, L);
    S.quad();
  }

  wall(S, d, x0, z0, c, yb, yt, k, drop, L, cs) {
    S.ensure(4);
    let r = this.R[k], g = this.Gc[k], b = this.Bc[k];
    const fl = this.FL[k];
    if (!(fl & LODF_CANOPY)) {
      if (fl & LODF_SAND) { r = 214; g = 196; b = 140; }
      else if (fl & LODF_SNOW && drop < cs * 2) { r = 226; g = 232; b = 240; }
      else if (!(fl & LODF_CLIFF)) {
        if (drop >= 3 * cs) { r = ROCK[0]; g = ROCK[1]; b = ROCK[2]; } else { r = 120; g = 92; b = 66; }
      }
    } else { r *= 0.8; g *= 0.8; b *= 0.8; }
    const hs = this.HS[k], x1 = x0 + cs, z1 = z0 + cs, lo = 150, hi = 255;
    const face = d === 0 ? 0 : d === 1 ? 1 : d === 2 ? 4 : 5;
    const m1 = (fl | LODF_CLIFF * (drop >= 3 * cs ? 1 : 0));
    if (d === 0) {
      S.v(x1, yb, z1, r, g, b, lo, face, m1, hs, L); S.v(x1, yb, z0, r, g, b, lo, face, m1, hs, L); S.v(x1, yt, z0, r, g, b, hi, face, m1, hs, L); S.v(x1, yt, z1, r, g, b, hi, face, m1, hs, L);
    } else if (d === 1) {
      S.v(x0, yb, z0, r, g, b, lo, face, m1, hs, L); S.v(x0, yb, z1, r, g, b, lo, face, m1, hs, L); S.v(x0, yt, z1, r, g, b, hi, face, m1, hs, L); S.v(x0, yt, z0, r, g, b, hi, face, m1, hs, L);
    } else if (d === 2) {
      S.v(x0, yb, z1, r, g, b, lo, face, m1, hs, L); S.v(x1, yb, z1, r, g, b, lo, face, m1, hs, L); S.v(x1, yt, z1, r, g, b, hi, face, m1, hs, L); S.v(x0, yt, z1, r, g, b, hi, face, m1, hs, L);
    } else {
      S.v(x1, yb, z0, r, g, b, lo, face, m1, hs, L); S.v(x0, yb, z0, r, g, b, lo, face, m1, hs, L); S.v(x0, yt, z0, r, g, b, hi, face, m1, hs, L); S.v(x1, yt, z0, r, g, b, hi, face, m1, hs, L);
    }
    S.quad();
  }
}
