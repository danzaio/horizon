// Seeded simplex noise (2D/3D) + fBm / ridged helpers. Allocation-free hot paths, safe in workers.
const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6, F3 = 1 / 3, G3 = 1 / 6;
const GRAD3 = new Float32Array([1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1]);

/** Small fast seeded PRNG (mulberry32). Returns a function giving floats in [0,1). */
export function rng(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer hash of up to 3 ints -> uint32. */
export function hash3(x, y, z) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(z | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

export class Noise {
  /** @param {number} seed integer seed */
  constructor(seed) {
    const r = rng(seed ^ 0x5bd1e995);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) { const j = (r() * (i + 1)) | 0; const t = p[i]; p[i] = p[j]; p[j] = t; }
    this.perm = new Uint8Array(512);
    this.pm12 = new Uint8Array(512);
    for (let i = 0; i < 512; i++) { this.perm[i] = p[i & 255]; this.pm12[i] = this.perm[i] % 12; }
  }

  /** 2D simplex noise in about [-1,1]. */
  n2(xin, yin) {
    const perm = this.perm, pm = this.pm12;
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s), j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t), y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0, j1 = 1 - i1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    let n = 0, tt = 0.5 - x0 * x0 - y0 * y0, gi;
    if (tt > 0) { gi = pm[ii + perm[jj]] * 3; tt *= tt; n += tt * tt * (GRAD3[gi] * x0 + GRAD3[gi + 1] * y0); }
    tt = 0.5 - x1 * x1 - y1 * y1;
    if (tt > 0) { gi = pm[ii + i1 + perm[jj + j1]] * 3; tt *= tt; n += tt * tt * (GRAD3[gi] * x1 + GRAD3[gi + 1] * y1); }
    tt = 0.5 - x2 * x2 - y2 * y2;
    if (tt > 0) { gi = pm[ii + 1 + perm[jj + 1]] * 3; tt *= tt; n += tt * tt * (GRAD3[gi] * x2 + GRAD3[gi + 1] * y2); }
    return 70 * n;
  }

  /** 3D simplex noise in about [-1,1]. */
  n3(xin, yin, zin) {
    const perm = this.perm, pm = this.pm12;
    const s = (xin + yin + zin) * F3;
    const i = Math.floor(xin + s), j = Math.floor(yin + s), k = Math.floor(zin + s);
    const t = (i + j + k) * G3;
    const x0 = xin - (i - t), y0 = yin - (j - t), z0 = zin - (k - t);
    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
      else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else {
      if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
      else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
      else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    }
    const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
    const ii = i & 255, jj = j & 255, kk = k & 255;
    let n = 0, tt = 0.6 - x0 * x0 - y0 * y0 - z0 * z0, gi;
    if (tt > 0) { gi = pm[ii + perm[jj + perm[kk]]] * 3; tt *= tt; n += tt * tt * (GRAD3[gi] * x0 + GRAD3[gi + 1] * y0 + GRAD3[gi + 2] * z0); }
    tt = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (tt > 0) { gi = pm[ii + i1 + perm[jj + j1 + perm[kk + k1]]] * 3; tt *= tt; n += tt * tt * (GRAD3[gi] * x1 + GRAD3[gi + 1] * y1 + GRAD3[gi + 2] * z1); }
    tt = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (tt > 0) { gi = pm[ii + i2 + perm[jj + j2 + perm[kk + k2]]] * 3; tt *= tt; n += tt * tt * (GRAD3[gi] * x2 + GRAD3[gi + 1] * y2 + GRAD3[gi + 2] * z2); }
    tt = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (tt > 0) { gi = pm[ii + 1 + perm[jj + 1 + perm[kk + 1]]] * 3; tt *= tt; n += tt * tt * (GRAD3[gi] * x3 + GRAD3[gi + 1] * y3 + GRAD3[gi + 2] * z3); }
    return 32 * n;
  }

  /** fBm of n2, normalised to about [-1,1]. */
  fbm2(x, y, octaves, lac = 2, gain = 0.5) {
    let sum = 0, amp = 1, tot = 0, f = 1;
    for (let o = 0; o < octaves; o++) { sum += amp * this.n2(x * f, y * f); tot += amp; amp *= gain; f *= lac; }
    return sum / tot;
  }

  /** Ridged multifractal of n2 in about [0,1] (1 = sharp ridge). */
  ridged2(x, y, octaves, lac = 2.05, gain = 0.5) {
    let sum = 0, amp = 1, tot = 0, f = 1, w = 1;
    for (let o = 0; o < octaves; o++) {
      let n = 1 - Math.abs(this.n2(x * f, y * f));
      n *= n; n *= w;
      w = Math.min(1, Math.max(0, n * 1.6));
      sum += amp * n; tot += amp; amp *= gain; f *= lac;
    }
    return sum / tot;
  }
}


// ---- macro colour variation: smooth 0..1 value noise in world X/Z, shared by chunk meshes and LOD tiles so grass/foliage tint matches ----
const mh = (ix, iz) => { let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
function mvn(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz, sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = mh(ix, iz), b = mh(ix + 1, iz), c = mh(ix, iz + 1), d = mh(ix + 1, iz + 1);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}
/** @returns {number} 0..1, ~17-block blotches plus ~6-block detail */
export function macroNoise(x, z) { return mvn(x / 17 + 11.3, z / 17 - 4.7) * 0.65 + mvn(x / 6.1 - 2.2, z / 6.1 + 7.9) * 0.35; }
