// Mock World (§4b API): rolling heightfield, naive face-culled meshing with baked vertex colours, DDA raycast. For ?mock=1 / ?mock=world.
import * as THREE from 'three';
import { B, OPAQUE, LIQUID, RENDER, RENDER_CROSS, RENDER_CUBE } from '../../shared/blocks.js';
import { CHUNK_SIZE, CHUNK_VOLUME, WORLD_HEIGHT, SEA_LEVEL, WATER_TOP, vIndex } from '../../shared/constants.js';
import { blockColor } from '../blockColors.js';

const CS = CHUNK_SIZE;
// corner tables (CCW from outside) for faces +X -X +Y -Y +Z -Z
const CORNERS = [
  [[1,0,1],[1,0,0],[1,1,0],[1,1,1]], [[0,0,0],[0,0,1],[0,1,1],[0,1,0]], [[0,1,1],[1,1,1],[1,1,0],[0,1,0]],
  [[0,0,0],[1,0,0],[1,0,1],[0,0,1]], [[0,0,1],[1,0,1],[1,1,1],[0,1,1]], [[1,0,0],[0,0,0],[0,1,0],[1,1,0]],
];
const NORM = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
const SHADE = [0.82, 0.82, 1, 0.5, 0.9, 0.9];
const hash = (x, y, z) => { let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

export class MockWorld {
  constructor({ seed = 1, scene, quality, onProgress }) {
    this.seed = seed; this.scene = scene; this.onProgress = onProgress || (() => {});
    this.group = new THREE.Group(); scene.add(this.group);
    this.solidMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    this.waterMat = new THREE.MeshBasicMaterial({ color: 0x3a6fd8, transparent: true, opacity: 0.62, depthWrite: false });
    this.data = new Map(); this.meshes = new Map(); this.dirty = new Set();
    this.radius = 4; this.queue = []; this._ccx = 1e9; this._ccz = 1e9; this._ready = false; this._meshedNear = 0;
    this._s = seed * 0.37; this._tris = 0; this._genMs = 0; this._meshMs = 0; this._ng = 0; this._nm = 0;
    this.setQuality(quality || { chunkRadius: 4 });
  }
  heightAt(x, z) {
    const s = this._s;
    return Math.floor(66 + 9 * Math.sin(x * 0.021 + s) * Math.cos(z * 0.017 - s) + 4 * Math.sin(x * 0.07 + z * 0.05) + 2 * Math.sin(z * 0.13 + x * 0.11));
  }
  getSurfaceY(x, z) { return Math.max(this.heightAt(Math.floor(x), Math.floor(z)), SEA_LEVEL); }
  setQuality(p) { this.radius = Math.max(2, Math.min(6, p.chunkRadius | 0)); this._ccx = 1e9; }
  isReady() { return this._ready; }
  _gen(cx, cz) {
    const t0 = performance.now(), v = new Uint8Array(CHUNK_VOLUME), ox = cx * CS, oz = cz * CS;
    for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
      const h = this.heightAt(ox + x, oz + z), beach = h <= SEA_LEVEL + 1;
      for (let y = 0; y <= h; y++) v[vIndex(x, y, z)] = y === 0 ? B.BEDROCK : y < h - 3 ? B.STONE : y < h ? (beach ? B.SAND : B.DIRT) : (beach ? B.SAND : B.GRASS);
      for (let y = h + 1; y <= SEA_LEVEL; y++) v[vIndex(x, y, z)] = B.WATER;
      if (!beach && hash(ox + x, 1, oz + z) < 0.04) v[vIndex(x, h + 1, z)] = B.TALL_GRASS;
      if (!beach && hash(ox + x, 2, oz + z) < 0.004) { for (let y = 1; y <= 4; y++) v[vIndex(x, h + y, z)] = B.LOG_OAK; }
    }
    this.data.set(cx + ',' + cz, v); this._genMs += performance.now() - t0; this._ng++;
    return v;
  }
  getBlock(x, y, z) {
    if (y < 0) return B.BEDROCK; if (y >= WORLD_HEIGHT) return B.AIR;
    const v = this.data.get((x >> 5) + ',' + (z >> 5));
    return v ? v[vIndex(x & 31, y, z & 31)] : B.UNLOADED;
  }
  setBlock(x, y, z, id) {
    if (y < 0 || y >= WORLD_HEIGHT) return false;
    const v = this.data.get((x >> 5) + ',' + (z >> 5)); if (!v) return false;
    v[vIndex(x & 31, y, z & 31)] = id;
    const cx = x >> 5, cz = z >> 5; this.dirty.add(cx + ',' + cz);
    if ((x & 31) === 0) this.dirty.add((cx - 1) + ',' + cz); if ((x & 31) === 31) this.dirty.add((cx + 1) + ',' + cz);
    if ((z & 31) === 0) this.dirty.add(cx + ',' + (cz - 1)); if ((z & 31) === 31) this.dirty.add(cx + ',' + (cz + 1));
    this._mesh(cx, cz); this.dirty.delete(cx + ',' + cz);
    return true;
  }
  raycast(o, d, maxDist) {
    let x = Math.floor(o.x), y = Math.floor(o.y), z = Math.floor(o.z);
    const sx = Math.sign(d.x), sy = Math.sign(d.y), sz = Math.sign(d.z);
    const dx = d.x ? Math.abs(1 / d.x) : Infinity, dy = d.y ? Math.abs(1 / d.y) : Infinity, dz = d.z ? Math.abs(1 / d.z) : Infinity;
    let tx = d.x ? ((sx > 0 ? x + 1 - o.x : o.x - x) * dx) : Infinity, ty = d.y ? ((sy > 0 ? y + 1 - o.y : o.y - y) * dy) : Infinity, tz = d.z ? ((sz > 0 ? z + 1 - o.z : o.z - z) * dz) : Infinity;
    let nx = 0, ny = 0, nz = 0, t = 0;
    for (let i = 0; i < 200 && t <= maxDist; i++) {
      const b = this.getBlock(x, y, z);
      if (b !== B.AIR && b !== B.UNLOADED && !LIQUID[b]) return { x, y, z, nx, ny, nz, block: b, dist: t };
      if (tx < ty && tx < tz) { x += sx; t = tx; tx += dx; nx = -sx; ny = 0; nz = 0; }
      else if (ty < tz) { y += sy; t = ty; ty += dy; nx = 0; ny = -sy; nz = 0; }
      else { z += sz; t = tz; tz += dz; nx = 0; ny = 0; nz = -sz; }
    }
    return null;
  }
  getShadowCasters() {}
  update(camera) {
    const cx = Math.floor(camera.position.x / CS), cz = Math.floor(camera.position.z / CS);
    if (cx !== this._ccx || cz !== this._ccz) {
      this._ccx = cx; this._ccz = cz; this.queue.length = 0;
      const R = this.radius;
      for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) if (dx * dx + dz * dz <= R * R + 1) this.queue.push([cx + dx, cz + dz, dx * dx + dz * dz]);
      this.queue.sort((a, b) => b[2] - a[2]); // pop() = nearest
      for (const [k, m] of this.meshes) { const [mx, mz] = k.split(',').map(Number); if (Math.abs(mx - cx) > R + 2 || Math.abs(mz - cz) > R + 2) { this._drop(k, m); } }
      this._need = this.queue.length;
    }
    const t0 = performance.now();
    while (this.queue.length && performance.now() - t0 < 4) {
      const [qx, qz] = this.queue.pop(); const k = qx + ',' + qz;
      if (!this.meshes.has(k)) this._mesh(qx, qz);
    }
    for (const k of this.dirty) { const [mx, mz] = k.split(',').map(Number); if (this.meshes.has(k)) this._mesh(mx, mz); this.dirty.delete(k); }
    const need = this._need || 1, done = need - this.queue.length;
    this.onProgress(Math.min(1, done / need));
    if (!this._ready && this.queue.length < need - Math.min(need, 25)) this._ready = true;
    if (!this._ready && this.queue.length === 0) this._ready = true;
  }
  _drop(k, m) { this.group.remove(m.solid, m.water); m.solid.geometry.dispose(); m.water.geometry.dispose(); this.meshes.delete(k); this.data.delete(k); }
  _mesh(cx, cz) {
    const t0 = performance.now(), key = cx + ',' + cz, ox = cx * CS, oz = cz * CS;
    const arrs = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) arrs.push(this.data.get((cx + dx) + ',' + (cz + dz)) || this._gen(cx + dx, cz + dz));
    const peek = (lx, y, lz) => {
      if (y < 0) return B.BEDROCK; if (y >= WORLD_HEIGHT) return B.AIR;
      return arrs[(lz < 0 ? 0 : lz >= CS ? 2 : 1) * 3 + (lx < 0 ? 0 : lx >= CS ? 2 : 1)][vIndex(lx & 31, y, lz & 31)];
    };
    const pos = [], col = [], idx = [], wpos = [], widx = [];
    let maxY = 0;
    for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) for (let y = WORLD_HEIGHT - 1; y > 0; y--) { if (peek(x, y, z) !== B.AIR) { if (y > maxY) maxY = y; break; } }
    for (let y = 0; y <= maxY; y++) for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
      const b = peek(x, y, z); if (b === B.AIR) continue;
      if (LIQUID[b]) { if (peek(x, y + 1, z) === B.AIR) { const n = wpos.length / 3, yy = y + WATER_TOP; wpos.push(x, yy, z + 1, x + 1, yy, z + 1, x + 1, yy, z, x, yy, z); widx.push(n, n + 1, n + 2, n, n + 2, n + 3); } continue; }
      const c = blockColor(b), v = 0.93 + hash(ox + x, y, oz + z) * 0.1;
      if (RENDER[b] === RENDER_CROSS) {
        const n = pos.length / 3;
        pos.push(x, y, z, x + 1, y, z + 1, x + 1, y + 1, z + 1, x, y + 1, z, x, y, z + 1, x + 1, y, z, x + 1, y + 1, z, x, y + 1, z + 1);
        for (let i = 0; i < 8; i++) col.push(c[0] * 255, c[1] * 255, c[2] * 255);
        idx.push(n, n + 1, n + 2, n, n + 2, n + 3, n + 4, n + 5, n + 6, n + 4, n + 6, n + 7); continue;
      }
      if (RENDER[b] !== RENDER_CUBE && b !== B.UNLOADED) continue;
      for (let f = 0; f < 6; f++) {
        const nb = peek(x + NORM[f][0], y + NORM[f][1], z + NORM[f][2]);
        if (OPAQUE[nb] || (nb === b && !OPAQUE[b] && b !== B.LEAVES_OAK)) continue;
        const n = pos.length / 3; let r = c[0], g = c[1], bl = c[2];
        if (b === B.GRASS && f !== 2) { const d = blockColor(B.DIRT); r = d[0]; g = d[1]; bl = d[2]; }
        const s = SHADE[f] * v;
        for (let k = 0; k < 4; k++) { const q = CORNERS[f][k]; pos.push(x + q[0], y + q[1], z + q[2]); col.push(r * s * 255, g * s * 255, bl * s * 255); }
        idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
      }
    }
    let m = this.meshes.get(key);
    if (m) { this.group.remove(m.solid, m.water); m.solid.geometry.dispose(); m.water.geometry.dispose(); }
    const gs = new THREE.BufferGeometry();
    gs.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); gs.setAttribute('color', new THREE.Uint8BufferAttribute(col, 3, true)); gs.setIndex(idx);
    gs.boundingSphere = new THREE.Sphere(new THREE.Vector3(16, maxY / 2, 16), 40 + maxY); 
    const gw = new THREE.BufferGeometry();
    gw.setAttribute('position', new THREE.Float32BufferAttribute(wpos, 3)); gw.setIndex(widx); gw.boundingSphere = gs.boundingSphere;
    const solid = new THREE.Mesh(gs, this.solidMat), water = new THREE.Mesh(gw, this.waterMat);
    for (const o of [solid, water]) { o.position.set(ox, 0, oz); o.matrixAutoUpdate = false; o.updateMatrix(); }
    water.renderOrder = 2;
    this.group.add(solid, water);
    this.meshes.set(key, { solid, water, tris: idx.length / 3 });
    this._meshMs += performance.now() - t0; this._nm++;
  }
  stats() {
    let tris = 0; for (const m of this.meshes.values()) tris += m.tris;
    return { chunks: this.meshes.size, chunkQueue: this.queue.length, lodTiles: 0, lodQueue: 0, workersBusy: 0, tris, genMsAvg: this._ng ? this._genMs / this._ng : 0, meshMsAvg: this._nm ? this._meshMs / this._nm : 0, uploadsPerFrame: 0, dataChunks: this.data.size };
  }
  dispose() { for (const [k, m] of [...this.meshes]) this._drop(k, m); this.scene.remove(this.group); this.solidMat.dispose(); this.waterMat.dispose(); }
}
