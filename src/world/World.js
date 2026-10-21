// World: LOD quadtree selection, worker job scheduling, mesh upload/visibility (no holes), voxel data access & edits.
import * as THREE from 'three';
import { SEA_LEVEL, MAX_LOD, CHUNK_VOLUME } from '../shared/constants.js';
import { B, LIQUID } from '../shared/blocks.js';
import { createTerrain } from './terrain.js';
import { WorkerPool } from './WorkerPool.js';

const FADE_MS = 450;
// per-mesh fade: the shared uFade uniform is raised for just this draw (uniformsNeedUpdate re-uploads it), then restored
function fadeBefore(r, sc, cam, g, mat) { const f = this.userData.fade; if (f < 1) { mat.uniforms.uFade.value = f; mat.uniformsNeedUpdate = true; } }
function fadeAfter(r, sc, cam, g, mat) { if (this.userData.fade < 1) { mat.uniforms.uFade.value = 1; mat.uniformsNeedUpdate = true; } }

const ck = (x, z) => (x + 32768) * 65536 + (z + 32768);
const tk = (L, x, z) => ck(x, z) * 16 + L;

class Node {
  constructor(L, tx, tz, key) {
    this.L = L; this.tx = tx; this.tz = tz; this.key = key;
    this.state = 0;          // 0 none, 1 queued, 2 in flight, 3 loaded
    this.solid = null; this.water = null; this.voxels = null;
    this.tris = 0; this.wantStamp = -1; this.lastUsed = 0; this.shown = false; this.showStamp = -1;
    this.dirty = false; this.ver = 0; this.upVer = -1; this.prio = 0; this.vreq = false; this.edit = false; this.dead = false;
  }
}

export class World {
  /**
   * @param {{seed:number, scene:THREE.Object3D, materials:object, quality:object, onProgress?:(p:number)=>void, events?:object, profile?:object}} o
   *   events: shared EventBus (World emits 'world:blockSet'); profile: PlanetProfile (planet look/terrain params, see docs/CONTRACT2.md)
   */
  constructor({ seed, scene, materials, quality, onProgress, events, profile }) {
    this.seed = seed | 0; this.materials = materials; this.onProgress = onProgress || null;
    this.events = events || null; this.profile = profile || null;
    this.group = new THREE.Group(); this.group.name = 'world';
    if (scene) scene.add(this.group);
    this.terrain = createTerrain(this.seed);
    this.nodes = new Map();
    this.loadedChunks = new Set();
    this.queue = []; this.urgent = []; this.vq = []; this.results = [];
    this.overlay = new Map();
    this.editRev = 0;                   // bumps on every player edit (save-game dirty flag)
    this.shown = []; this.shownPrev = []; this.showCount = 0;
    this.selStamp = 0; this.dirty = true; this.lastSelT = 0; this.selX = 1e12; this.selZ = 1e12; this.selY = 0; this.camY = 0; this.sortX = 1e12; this.sortZ = 1e12; this.queueDirty = false;
    this.camX = 0; this.camZ = 0; this.dyv = 0; this.fx = 0; this.fz = 1; this.now = 0;
    this.refined = new Set(); this.refinedNext = new Set();
    this.lastEvict = 0; this.ready = false; this.progress = 0;
    this._last = null;
    this.trisShown = 0; this.genMs = 0; this.meshMs = 0; this.uploads = 0; this.uploadsAvg = 0; this.lodMs = 0;
    // dither fade-in of nodes that replace a coarser one (the coarse parent lingers underneath, so no holes)
    this.fading = []; this.linger = []; this.fadeOn = false; this._hidden = [];
    this.disposed = false;
    this.pool = new WorkerPool(1, (d) => { this.results.push(d); this._pump(); }, 2, (m) => this._fail(m));
    this.setQuality(quality);
  }

  /** @param {object} q quality preset */
  setQuality(q) {
    this.q = q;
    this.vd = q.viewDistance;
    this.pool.resize(q.workers || 2);
    const cr = q.chunkRadius * 32;
    this.rootL = Math.min(MAX_LOD, Math.max(2, Math.ceil(Math.log2(this.vd / 32))));
    this.refineR = new Float64Array(MAX_LOD + 2);
    this.refineR[1] = Math.max(cr - 16, 64);
    for (let L = 2; L <= MAX_LOD + 1; L++) this.refineR[L] = Math.max((32 << L) * q.lodFactor, this.refineR[L - 1] * 1.3);
    this.dataR = Math.min(3, q.chunkRadius);
    this.refined.clear();
    this.dirty = true;
  }

  // ------------------------------------------------------------------ per-frame
  update(camera, dt) {
    if (this.disposed) return;
    const now = this.now = performance.now();
    const p = camera.position, e = camera.matrixWorld.elements;
    this.camX = p.x; this.camZ = p.z; this.dyv = Math.max(0, p.y - 130); this.camY = p.y;
    let fx = -e[8], fz = -e[10]; const fl = Math.hypot(fx, fz);
    if (fl > 0.05) { this.fx = fx / fl; this.fz = fz / fl; }
    this._processResults(now);
    const moved = Math.abs(this.camX - this.selX) + Math.abs(this.camZ - this.selZ) + Math.abs(this.camY - this.selY);
    if (this.dirty || moved > 2 || now - this.lastSelT > 250) this._select(now);
    this._tickFades(now);
    this._pump();
    if (now - this.lastEvict > 500) this._evict(now);
  }

  _processResults(now) {
    const budget = (this.q.meshUploadMs || 3) * (this.results.length > 24 ? 2.5 : 1), t0 = performance.now();
    let n = 0;
    while (this.results.length) {
      const ui = this.results.findIndex(r => r.urgent);
      const d = ui >= 0 ? this.results.splice(ui, 1)[0] : this.results.shift();
      this._upload(d);
      n++;
      if (performance.now() - t0 > budget) break;
    }
    this.uploads = n; this.uploadsAvg += (n - this.uploadsAvg) * 0.05;
    if (n) this.dirty = true;
  }

  /** a job crashed: retry up to 2 times, then give the node an empty mesh so it can never block coverage logic */
  _fail(m) {
    const node = this.nodes.get(m.type === 'chunk' ? tk(0, m.cx, m.cz) : tk(m.L, m.tx, m.tz));
    if (!node || node.dead) return;
    node.fails = (node.fails || 0) + 1;
    console.warn('[HZ] world job failed', m.type, node.L, node.tx, node.tz, 'attempt', node.fails);
    if (node.fails <= 2) { node.state = 1; node.edit ? this.urgent.push(node) : this.queue.push(node); this.queueDirty = true; }
    else { node.state = 3; if (node.upVer < 0) node.upVer = 0; node.tris = 0; }
    this.dirty = true;
  }

  _upload(d) {
    if (d.type === 'error') { this._fail(d.kind === 'chunk' ? { type: 'chunk', cx: d.cx, cz: d.cz } : { type: 'lod', L: d.L, tx: d.tx, tz: d.tz }); console.warn('[HZ] worker error', d.msg); return; }
    if (d.type === 'chunk') {
      const node = this.nodes.get(tk(0, d.cx, d.cz));
      if (!node) return;
      node.state = 3;
      this.genMs += (d.genMs - this.genMs) * 0.1; this.meshMs += (d.meshMs - this.meshMs) * 0.1;
      if (d.voxels && !node.voxels) node.voxels = d.voxels;
      if (!d.skipMesh && d.ver >= node.upVer) {
        node.upVer = d.ver;
        this._setMeshes(node, d.solid, d.water, 32, this.materials.solid, this.materials.water);
        this.loadedChunks.add(node);
      } else if (d.skipMesh) { node.vreq = false; }
      if (node.dirty) { node.edit ? this.urgent.push(node) : this.queue.push(node); node.state = 1; this.queueDirty = true; }
      node.lastUsed = this.now;
    } else {
      const node = this.nodes.get(tk(d.L, d.tx, d.tz));
      if (!node) return;
      this.lodMs += (d.ms - this.lodMs) * 0.1;
      node.state = 3; node.upVer = 0;
      this._setMeshes(node, d.solid, d.water, 32 << d.L, this.materials.lodSolid, this.materials.lodWater);
      node.lastUsed = this.now;
    }
  }

  _setMeshes(node, solid, water, edge, matS, matW) {
    this._freeMeshes(node);
    const L = node.L, ox = node.tx * edge, oz = node.tz * edge;
    node.tris = 0;
    if (solid) { node.solid = this._mesh(solid, L, edge, matS, ox, oz, 0); node.tris += solid.tris; }
    if (water) { node.water = this._mesh(water, L, edge, matW, ox, oz, 1); node.tris += water.tris; }
    if (node.shown) { if (node.solid) node.solid.visible = true; if (node.water) node.water.visible = true; }
    else { if (node.solid) node.solid.visible = false; if (node.water) node.water.visible = false; }
  }

  _mesh(d, L, edge, material, ox, oz, order) {
    const g = new THREE.BufferGeometry();
    if (L === 0) {
      g.setAttribute('aPos', new THREE.BufferAttribute(d.aPos, 4));
      g.setAttribute('aMeta', new THREE.BufferAttribute(d.aMeta, 4));
      g.setAttribute('aTint', new THREE.BufferAttribute(d.aTint, 4, true));
    } else {
      g.setAttribute('position', new THREE.BufferAttribute(d.position, 3));
      g.setAttribute('aColor', new THREE.BufferAttribute(d.aColor, 4, true));
      g.setAttribute('aMeta', new THREE.BufferAttribute(d.aMeta, 4));
    }
    g.setIndex(new THREE.BufferAttribute(d.index, 1));
    // drop the CPU copies once uploaded to the GPU (meshes are static) to keep memory lean
    for (const k in g.attributes) { const a = g.attributes[k]; a.onUpload(() => { a.array = null; }); }
    g.index.onUpload(() => { g.index.array = null; });
    const y0 = Math.floor(d.minY) - 1, y1 = Math.ceil(d.maxY) + 1;
    g.boundingBox = new THREE.Box3(new THREE.Vector3(0, y0, 0), new THREE.Vector3(edge, y1, edge));
    const sp = new THREE.Sphere(); g.boundingBox.getBoundingSphere(sp); g.boundingSphere = sp;
    const m = new THREE.Mesh(g, material);
    m.position.set(ox, 0, oz); m.matrixAutoUpdate = false; m.updateMatrix();
    m.frustumCulled = true; m.renderOrder = order; m.visible = false;
    if (order === 1) m.layers.set(2);   // water lives on layer 2 so the renderer can draw it after (and reading from) the opaque pass
    this.group.add(m);
    return m;
  }

  _freeMeshes(node) {
    if (node.solid) { this.group.remove(node.solid); node.solid.geometry.dispose(); node.solid = null; }
    if (node.water) { this.group.remove(node.water); node.water.geometry.dispose(); node.water = null; }
  }

  _disposeNode(node) {
    this._freeMeshes(node);
    node.dead = true; node.voxels = null;
    this.loadedChunks.delete(node);
    this.nodes.delete(node.key);
    if (this._last === node) this._last = null;
  }

  // ------------------------------------------------------------------ LOD selection (quadtree) + no-hole visibility
  _select(now) {
    this.lastSelT = now; this.selX = this.camX; this.selZ = this.camZ; this.selY = this.camY; this.dirty = false;
    this.selStamp++;
    this.showCount = 0; this.refinedNext.clear();
    this.nearTotal = 0; this.nearLoaded = 0;
    const edge = 32 << this.rootL, vd = this.vd;
    const x0 = Math.floor((this.camX - vd) / edge), x1 = Math.floor((this.camX + vd) / edge);
    const z0 = Math.floor((this.camZ - vd) / edge), z1 = Math.floor((this.camZ + vd) / edge);
    for (let tz = z0; tz <= z1; tz++) for (let tx = x0; tx <= x1; tx++) this._visit(this.rootL, tx, tz);
    const t = this.refined; this.refined = this.refinedNext; this.refinedNext = t;
    // apply visibility
    const stamp = this.selStamp; let tris = 0;
    const hidden = this._hidden; hidden.length = 0;
    for (let i = 0; i < this.showCount; i++) { const n = this.shown[i]; n.showStamp = stamp; n.lastUsed = now; tris += n.tris; }
    for (let i = 0; i < this.shownPrev.length; i++) { const n = this.shownPrev[i]; if (n.showStamp !== stamp && n.shown) hidden.push(n); }
    for (let i = 0; i < this.showCount; i++) {
      const n = this.shown[i];
      if (!n.shown) {
        n.shown = true; if (n.solid) n.solid.visible = true; if (n.water) n.water.visible = true;
        if (this.fadeOn && hidden.length && this._replacesCoarser(n, hidden)) this._startFade(n, now);
      }
    }
    for (let i = 0; i < hidden.length; i++) {
      const n = hidden[i]; n.shown = false;
      if (this.fading.length && this._coversFading(n)) { n.lingerUntil = now + FADE_MS + 60; this.linger.push(n); }
      else { if (n.solid) n.solid.visible = false; if (n.water) n.water.visible = false; }
    }
    // keep a copy of the shown list for the next diff
    this.shownPrev.length = this.showCount;
    for (let i = 0; i < this.showCount; i++) this.shownPrev[i] = this.shown[i];
    this.trisShown = tris;
    if (this.queueDirty || Math.abs(this.camX - this.sortX) + Math.abs(this.camZ - this.sortZ) > 12) this._sortQueue();
    // readiness
    const idle = this.queue.length === 0 && this.urgent.length === 0 && this.pool.busy() === 0 && this.results.length === 0;
    const prog = this.nearTotal ? Math.min(1, this.nearLoaded / this.nearTotal) : (idle ? 1 : 0);
    if (prog !== this.progress) { this.progress = prog; if (this.onProgress) this.onProgress(prog); }
    this.ready = this.nearTotal > 0 ? this.nearLoaded >= this.nearTotal : idle;
    if (this.ready && !this.fadeOn && idle) this.fadeOn = true;
  }

  /** n sits inside a coarser node that is being hidden this very pass (=> it refines it, so it may fade in over the parent) */
  _replacesCoarser(n, hidden) {
    for (let i = 0; i < hidden.length; i++) { const h = hidden[i]; if (h.L > n.L && (n.tx >> (h.L - n.L)) === h.tx && (n.tz >> (h.L - n.L)) === h.tz) return true; }
    return false;
  }
  /** h (just hidden) is a coarse node lying under a node that is still fading in */
  _coversFading(h) {
    for (let i = 0; i < this.fading.length; i++) { const f = this.fading[i]; if (h.L > f.L && (f.tx >> (h.L - f.L)) === h.tx && (f.tz >> (h.L - f.L)) === h.tz) return true; }
    return false;
  }
  _startFade(n, now) {
    const ms = [n.solid, n.water]; let any = false;
    for (const m of ms) if (m) { m.userData.fade = 0; m.onBeforeRender = fadeBefore; m.onAfterRender = fadeAfter; any = true; }
    if (any) { n.fadeT0 = now; this.fading.push(n); }
  }
  _endFade(n) {
    for (const m of [n.solid, n.water]) if (m) { m.userData.fade = 1; delete m.onBeforeRender; delete m.onAfterRender; }
  }
  _tickFades(now) {
    for (let i = this.fading.length - 1; i >= 0; i--) {
      const n = this.fading[i], f = (now - n.fadeT0) / FADE_MS;
      if (n.dead || f >= 1 || (!n.solid && !n.water)) { this._endFade(n); this.fading.splice(i, 1); continue; }
      const e = f * f * (3 - 2 * f);
      if (n.solid) n.solid.userData.fade = e; if (n.water) n.water.userData.fade = e;
    }
    for (let i = this.linger.length - 1; i >= 0; i--) {
      const n = this.linger[i];
      if (now < n.lingerUntil && !n.dead) continue;
      if (!n.shown && !n.dead) { if (n.solid) n.solid.visible = false; if (n.water) n.water.visible = false; }
      this.linger.splice(i, 1);
    }
  }

  _show(node) { this.shown[this.showCount++] = node; }

  /** returns true when the node's area is fully covered by displayable meshes (or is out of range) */
  _visit(L, tx, tz) {
    const edge = 32 << L, x0 = tx * edge, z0 = tz * edge;
    const dx = Math.max(x0 - this.camX, 0, this.camX - (x0 + edge)), dz = Math.max(z0 - this.camZ, 0, this.camZ - (z0 + edge));
    const d = Math.hypot(dx, dz, this.dyv);
    if (d > this.vd) return true;
    const key = tk(L, tx, tz);
    if (L > 0) {
      const R = this.refineR[L];
      if (d < (this.refined.has(key) ? R * 1.12 : R)) {
        this.refinedNext.add(key);
        const mark = this.showCount, nx = tx * 2, nz = tz * 2;
        let all = true;
        if (!this._visit(L - 1, nx, nz)) all = false;
        if (!this._visit(L - 1, nx + 1, nz)) all = false;
        if (!this._visit(L - 1, nx, nz + 1)) all = false;
        if (!this._visit(L - 1, nx + 1, nz + 1)) all = false;
        if (all) return true;
        // children not ready: coarse levels also load themselves as a cheap placeholder so the horizon fills in within seconds
        // (placeholders are only requested outside the chunk radius so the first chunks around the player show immediately)
        const far = d >= this.refineR[1] * 0.5;
        let node = this.nodes.get(key);
        if (L >= 3 && far && (!node || node.upVer < 0)) node = this._want(L, tx, tz, key);
        if (node && node.upVer >= 0) { this.showCount = mark; this._show(node); node.lastUsed = this.now; return true; }
        return false;
      }
    }
    // leaf
    const node = this._want(L, tx, tz, key);
    if (L === 0) {
      const ccx = tx * 32 + 16 - this.camX, ccz = tz * 32 + 16 - this.camZ;
      if (Math.max(Math.abs(ccx), Math.abs(ccz)) < 80) { this.nearTotal++; if (node.state === 3) this.nearLoaded++; }
    }
    if (L === 0 && node.state === 3 && !node.voxels && !node.vreq && Math.max(Math.abs(tx - Math.floor(this.camX / 32)), Math.abs(tz - Math.floor(this.camZ / 32))) <= this.dataR) {
      node.vreq = true; this.vq.push(node);
    }
    if (node.upVer >= 0) { this._show(node); return true; }
    return this._showDesc(L, tx, tz);
  }

  /** mark a node wanted this selection (creating/queueing it if needed) */
  _want(L, tx, tz, key) {
    let node = this.nodes.get(key);
    if (!node) { node = new Node(L, tx, tz, key); this.nodes.set(key, node); }
    node.wantStamp = this.selStamp; node.lastUsed = this.now;
    if (node.state === 0) { node.state = 1; this.queue.push(node); this.queueDirty = true; }
    return node;
  }

  /** fallback: display already-loaded finer descendants */
  _showDesc(L, tx, tz) {
    const node = this.nodes.get(tk(L, tx, tz));
    if (node && node.upVer >= 0) { this._show(node); return true; }
    if (L === 0) return false;
    let all = true;
    const nx = tx * 2, nz = tz * 2;
    if (!this._showDesc(L - 1, nx, nz)) all = false;
    if (!this._showDesc(L - 1, nx + 1, nz)) all = false;
    if (!this._showDesc(L - 1, nx, nz + 1)) all = false;
    if (!this._showDesc(L - 1, nx + 1, nz + 1)) all = false;
    return all;
  }

  // ------------------------------------------------------------------ job queue
  /** smaller = sooner. Order: near chunks (isReady) -> coarse LOD (L>=3, coarse first) -> everything else by distance */
  _prio(n) {
    const edge = 32 << n.L, x0 = n.tx * edge, z0 = n.tz * edge;
    const dx = Math.max(x0 - this.camX, 0, this.camX - (x0 + edge)), dz = Math.max(z0 - this.camZ, 0, this.camZ - (z0 + edge));
    const d = Math.hypot(dx, dz);
    const cx = x0 + edge * 0.5 - this.camX, cz = z0 + edge * 0.5 - this.camZ, cl = Math.hypot(cx, cz) || 1;
    const front = d < 1 || (cx * this.fx + cz * this.fz) / cl > -0.25;
    if (n.L === 0) {
      if (cl < 130) return cl;                                   // class 0: chunks needed for isReady
      return 3e7 + (front ? cl : cl * 2.2 + (cl > this.q.chunkRadius * 64 ? 1e5 : 0));
    }
    if (n.L >= 3) return 1e7 + (MAX_LOD - n.L) * 1e5 + (front ? d : d * 2);   // class 1: coarse tiles, coarsest first
    return 3e7 + (front ? d : d * 2.2 + (d > this.q.chunkRadius * 64 ? 1e5 : 0)) - edge * 0.3;
  }

  _sortQueue() {
    this.queueDirty = false; this.sortX = this.camX; this.sortZ = this.camZ;
    const q = this.queue;
    let w = 0;
    for (let i = 0; i < q.length; i++) {
      const n = q[i];
      if (n.dead || n.state !== 1) continue;
      if (n.wantStamp !== this.selStamp && !n.dirty) { this._unqueue(n); continue; }
      n.prio = this._prio(n); q[w++] = n;
    }
    q.length = w;
    q.sort((a, b) => b.prio - a.prio); // best (smallest) at the end
  }

  /** drop a queued node that is no longer wanted */
  _unqueue(n) {
    if (n.upVer >= 0) n.state = 3; else { n.state = 0; n.dead = true; this.nodes.delete(n.key); }
  }

  _collectEdits(cx, cz) {
    if (!this.overlay.size) return null;
    const out = [];
    const x0 = cx * 32 - 1, x1 = cx * 32 + 32, z0 = cz * 32 - 1, z1 = cz * 32 + 32;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const m = this.overlay.get(ck(cx + dx, cz + dz));
      if (!m) continue;
      const bx = (cx + dx) * 32, bz = (cz + dz) * 32;
      for (const [idx, id] of m) {
        const x = bx + (idx & 31), z = bz + ((idx >> 5) & 31), y = idx >> 10;
        if (x >= x0 && x <= x1 && z >= z0 && z <= z1) out.push(x, y, z, id);
      }
    }
    return out.length ? new Int32Array(out) : null;
  }

  _dispatch(node) {
    node.state = 2; node.dirty = false;
    if (node.L === 0) {
      const wantVox = !node.voxels && Math.max(Math.abs(node.tx - Math.floor(this.camX / 32)), Math.abs(node.tz - Math.floor(this.camZ / 32))) <= this.dataR + 1;
      node.ver++;
      return this.pool.post({ type: 'chunk', id: node.key, cx: node.tx, cz: node.tz, seed: this.seed, ver: node.ver, edits: this._collectEdits(node.tx, node.tz), wantVoxels: wantVox, skipMesh: false, urgent: node.edit });
    }
    return this.pool.post({ type: 'lod', id: node.key, L: node.L, tx: node.tx, tz: node.tz, seed: this.seed });
  }

  _pump() {
    while (this.pool.free() > 0) {
      let node = null;
      while (this.urgent.length && !node) { const n = this.urgent.shift(); if (!n.dead && n.state === 1) node = n; }
      if (node) { this._dispatch(node); node.edit = false; continue; }
      while (this.vq.length && !node) { const n = this.vq.shift(); if (!n.dead && !n.voxels) node = n; }
      if (node) {
        this.pool.post({ type: 'chunk', id: node.key, cx: node.tx, cz: node.tz, seed: this.seed, ver: node.ver, edits: this._collectEdits(node.tx, node.tz), wantVoxels: true, skipMesh: true });
        continue;
      }
      let guard = 0;
      while (this.queue.length && !node && guard++ < 64) {
        const n = this.queue.pop();
        if (n.dead || n.state !== 1) continue;
        if (n.wantStamp !== this.selStamp && !n.dirty) { this._unqueue(n); continue; }
        node = n;
      }
      if (!node) break;
      if (!this._dispatch(node)) break;
    }
  }

  _evict(now) {
    this.lastEvict = now;
    const wantedCount = this.shownPrev.length;
    const cap = Math.max(300, wantedCount * 2 + 200);
    let n = 0;
    for (const node of this.nodes.values()) if (node.state === 3) n++;
    const ttl = n > cap ? 800 : 5000;
    for (const node of this.nodes.values()) {
      if (node.state !== 3 || node.shown) continue;
      if (now - node.lastUsed > ttl) this._disposeNode(node);
    }
    // free voxel data far from the camera
    const ccx = Math.floor(this.camX / 32), ccz = Math.floor(this.camZ / 32);
    for (const node of this.loadedChunks) {
      if (node.voxels && Math.max(Math.abs(node.tx - ccx), Math.abs(node.tz - ccz)) > this.dataR + 3) { node.voxels = null; node.vreq = false; }
    }
  }

  // ------------------------------------------------------------------ queries
  /** @returns {boolean} true when the area around the camera is meshed */
  isReady() { return this.ready; }

  getBlock(x, y, z) {
    if (y < 0) return B.BEDROCK;
    if (y >= 192) return B.AIR;
    const cx = x >> 5, cz = z >> 5;
    let n = this._last;
    if (!n || n.tx !== cx || n.tz !== cz) { n = this.nodes.get(tk(0, cx, cz)); this._last = n || null; }
    if (!n || !n.voxels) return B.UNLOADED;
    return n.voxels[(x & 31) + ((z & 31) << 5) + (y << 10)];
  }

  /** player edit; returns true if applied */
  setBlock(x, y, z, id, source = 'local') {
    if (y < 0 || y >= 192) return false;
    const cx = x >> 5, cz = z >> 5, node = this.nodes.get(tk(0, cx, cz));
    if (!node || !node.voxels) return false;
    const lx = x & 31, lz = z & 31, idx = lx + (lz << 5) + (y << 10), prev = node.voxels[idx];
    if (prev === id) return true;
    node.voxels[idx] = id;
    this._recordEdit(cx, cz, idx, id, lx, lz, node);
    if (this.events) this.events.emit('world:blockSet', { x, y, z, id, prev, source });
    return true;
  }

  /**
   * Edit that works ANYWHERE, loaded or not (remote players, minigame logic, snapshots): always recorded in the overlay, so the
   * worker applies it whenever that chunk is (re)generated; remeshes right away if the chunk is on screen.
   * Does not echo through the network layer unless `source` says so (listeners filter on source).
   */
  applyEdit(x, y, z, id, source = 'remote') {
    if (y < 0 || y >= 192) return false;
    const cx = x >> 5, cz = z >> 5, lx = x & 31, lz = z & 31, idx = lx + (lz << 5) + (y << 10), node = this.nodes.get(tk(0, cx, cz));
    if (node && node.voxels) {
      const prev = node.voxels[idx]; if (prev === id) return true;
      node.voxels[idx] = id; this._recordEdit(cx, cz, idx, id, lx, lz, node);
      if (this.events) this.events.emit('world:blockSet', { x, y, z, id, prev, source });
      return true;
    }
    const key = ck(cx, cz); let m = this.overlay.get(key); if (!m) { m = new Map(); this.overlay.set(key, m); }
    m.set(idx, id); this.editRev++;
    if (node && node.state !== 0) { node.dirty = true; node.edit = true; if (node.state === 3) { node.state = 1; this.urgent.push(node); } }   // on screen without voxel data: regenerate with the overlay
    if (this.events) this.events.emit('world:blockSet', { x, y, z, id, prev: -1, source });
    return true;
  }

  _recordEdit(cx, cz, idx, id, lx, lz, node) {
    const key = ck(cx, cz);
    let m = this.overlay.get(key); if (!m) { m = new Map(); this.overlay.set(key, m); }
    m.set(idx, id); this.editRev++;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (dx === -1 && lx !== 0 || dx === 1 && lx !== 31 || dz === -1 && lz !== 0 || dz === 1 && lz !== 31) continue;
      const nn = dx === 0 && dz === 0 ? node : this.nodes.get(tk(0, cx + dx, cz + dz));
      if (!nn || nn.state === 0 || nn.upVer < 0 && nn.state !== 2) continue;
      nn.dirty = true; nn.edit = true;
      if (nn.state === 3) { nn.state = 1; this.urgent.push(nn); }
    }
  }

  /** @returns {number[]} flat [cx, cz, voxelIndex, blockId, ...] of every player edit (JSON-friendly, for save games) */
  exportEdits() {
    const out = [];
    for (const [key, m] of this.overlay) { const k = Math.floor(key / 65536), cx = k - 32768, cz = key - k * 65536 - 32768; for (const [idx, id] of m) out.push(cx, cz, idx, id); }
    return out;
  }
  /** Re-applies exported edits. Call right after construction, before chunks are generated. */
  importEdits(arr) {
    for (let i = 0; i + 3 < arr.length; i += 4) {
      const key = ck(arr[i], arr[i + 1]); let m = this.overlay.get(key); if (!m) { m = new Map(); this.overlay.set(key, m); }
      m.set(arr[i + 2], arr[i + 3]);
    }
    this.editRev++;
  }

  /**
   * DDA over loaded voxels; hits solids and cross-plants, skips air/liquid.
   * @returns {null|{x:number,y:number,z:number,nx:number,ny:number,nz:number,block:number,dist:number}}
   */
  raycast(origin, dir, maxDist) {
    let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
    const sx = dir.x > 0 ? 1 : -1, sy = dir.y > 0 ? 1 : -1, sz = dir.z > 0 ? 1 : -1;
    const tdx = dir.x !== 0 ? Math.abs(1 / dir.x) : Infinity, tdy = dir.y !== 0 ? Math.abs(1 / dir.y) : Infinity, tdz = dir.z !== 0 ? Math.abs(1 / dir.z) : Infinity;
    let tx = dir.x !== 0 ? (sx > 0 ? x + 1 - origin.x : origin.x - x) * tdx : Infinity;
    let ty = dir.y !== 0 ? (sy > 0 ? y + 1 - origin.y : origin.y - y) * tdy : Infinity;
    let tz = dir.z !== 0 ? (sz > 0 ? z + 1 - origin.z : origin.z - z) * tdz : Infinity;
    let nx = 0, ny = 0, nz = 0, t = 0;
    for (let i = 0; i < 4096; i++) {
      const id = this.getBlock(x, y, z);
      if (id === B.UNLOADED) return null;
      if (id !== B.AIR && !LIQUID[id]) return { x, y, z, nx, ny, nz, block: id, dist: t };
      if (tx < ty && tx < tz) { t = tx; if (t > maxDist) return null; x += sx; tx += tdx; nx = -sx; ny = 0; nz = 0; }
      else if (ty < tz) { t = ty; if (t > maxDist) return null; y += sy; ty += tdy; nx = 0; ny = -sy; nz = 0; }
      else { t = tz; if (t > maxDist) return null; z += sz; tz += tdz; nx = 0; ny = 0; nz = -sz; }
    }
    return null;
  }

  /** y of the highest solid terrain block at (x,z) (trees ignored); at least SEA_LEVEL */
  getSurfaceY(x, z) { return Math.max(this.terrain.surfaceY(x, z), SEA_LEVEL); }

  /** pushes visible chunk solid meshes within radius to `out` and flags them on layer 1 */
  getShadowCasters(center, radius, out) {
    const r2 = (radius + 32) * (radius + 32);
    for (const node of this.loadedChunks) {
      const m = node.solid; if (!m) continue;
      const dx = node.tx * 32 + 16 - center.x, dz = node.tz * 32 + 16 - center.z;
      if (node.shown && dx * dx + dz * dz < r2) { out.push(m); m.layers.enable(1); }
      else if (m.layers.isEnabled(1)) m.layers.disable(1);
    }
  }

  stats() {
    if (this._stats && this.now - this._statsT < 200) { this._stats.workersBusy = this.pool.busy(); return this._stats; }
    this._statsT = this.now;
    let chunks = 0, lodTiles = 0, dataChunks = 0, cq = 0, lq = 0;
    for (const n of this.nodes.values()) {
      if (n.state === 3) { if (n.L === 0) chunks++; else lodTiles++; }
      else if (n.state === 1 || n.state === 2) { if (n.L === 0) cq++; else lq++; }
      if (n.voxels) dataChunks++;
    }
    return this._stats = { chunks, chunkQueue: cq, lodTiles, lodQueue: lq, workersBusy: this.pool.busy(), tris: this.trisShown, genMsAvg: this.genMs, meshMsAvg: this.meshMs, lodMsAvg: this.lodMs, uploadsPerFrame: this.uploadsAvg, dataChunks, shown: this.shownPrev.length };
  }

  dispose() {
    this.disposed = true;
    this.pool.dispose();
    for (const n of [...this.nodes.values()]) this._disposeNode(n);
    if (this.group.parent) this.group.parent.remove(this.group);
    this.nodes.clear(); this.loadedChunks.clear(); this.shown.length = this.shownPrev.length = 0; this.overlay.clear();
    this.queue.length = this.urgent.length = this.vq.length = this.results.length = 0;
  }
}
