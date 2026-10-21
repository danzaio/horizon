// In-world visuals for entities: ONE instanced box mesh (translucent) + ONE merged line mesh (outlines) + optional label sprites.
// Editor mode shows everything; play mode shows only the markers players need to see (goal, checkpoints, flags, zones, pads…). Nothing exists
// (and nothing is drawn) while no game and no editor is open: the group is created on first show() and removed on hide().
import { ENTITY_TYPES, entityBox } from './schema.js';

const PLAY_VISIBLE = new Set(['goal', 'checkpoint', 'flag', 'zone', 'pad', 'itemGiver', 'button', 'sign']);
const BOX_EDGES = [[0, 0, 0, 1, 0, 0], [1, 0, 0, 1, 0, 1], [1, 0, 1, 0, 0, 1], [0, 0, 1, 0, 0, 0], [0, 1, 0, 1, 1, 0], [1, 1, 0, 1, 1, 1], [1, 1, 1, 0, 1, 1], [0, 1, 1, 0, 1, 0],
  [0, 0, 0, 0, 1, 0], [1, 0, 0, 1, 1, 0], [1, 0, 1, 1, 1, 1], [0, 0, 1, 0, 1, 1]];

/** Slab ray/AABB test. box = [x0,y0,z0,x1,y1,z1]. Returns distance or -1. Allocation-free. */
export function rayBox(ox, oy, oz, dx, dy, dz, b, maxDist) {
  let t0 = 0, t1 = maxDist;
  for (let a = 0; a < 3; a++) {
    const o = a === 0 ? ox : a === 1 ? oy : oz, d = a === 0 ? dx : a === 1 ? dy : dz, lo = b[a], hi = b[a + 3];
    if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return -1; continue; }
    let ta = (lo - o) / d, tb = (hi - o) / d; if (ta > tb) { const s = ta; ta = tb; tb = s; }
    if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 > t1) return -1;
  }
  return t0;
}

/** potato tier (preset renderScale <= .5 / tiny chunk radius): no labels, smaller block batches */
export const lowEnd = (ctx) => { const q = ctx.gr && ctx.gr.quality; return !!q && (q.renderScale <= 0.5 || q.chunkRadius <= 3); };

export class EntityView {
  /** @param {object} ctx feature ctx (THREE, gr.scene, settings) */
  constructor(ctx) { this.ctx = ctx; this.group = null; this.mode = 'off'; this.def = null; this.sel = ''; this.hover = ''; this.labels = new Map(); this.boxes = new Map(); this._b = []; this._t = 0; }

  get active() { return this.mode !== 'off'; }

  _make() {
    const T = this.ctx.THREE, g = this.group = new T.Group(); g.name = 'minigame-entities'; g.renderOrder = 6;
    const geo = new T.BoxGeometry(1, 1, 1);
    this.mat = new T.MeshBasicMaterial({ transparent: true, opacity: 0.3, depthWrite: false, toneMapped: false });
    this.mesh = new T.InstancedMesh(geo, this.mat, 320); this.mesh.frustumCulled = false; this.mesh.count = 0; this.mesh.renderOrder = 6;
    this.mesh.instanceColor = new T.InstancedBufferAttribute(new Float32Array(320 * 3), 3);
    const lg = new T.BufferGeometry();
    lg.setAttribute('position', new T.BufferAttribute(new Float32Array(320 * 24 * 3), 3)); lg.setAttribute('color', new T.BufferAttribute(new Float32Array(320 * 24 * 3), 3));
    lg.setDrawRange(0, 0);
    this.lines = new T.LineSegments(lg, new T.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, toneMapped: false })); this.lines.frustumCulled = false; this.lines.renderOrder = 7;
    g.add(this.mesh, this.lines); this.ctx.gr.scene.add(g);
    this._m4 = new T.Matrix4(); this._col = new T.Color(); this._q = new T.Quaternion(); this._v = new T.Vector3(); this._s = new T.Vector3();
  }

  /**
   * @param {'editor'|'play'|'off'} mode
   * @param {object} def GameDef
   * @param {{sel?:string, hover?:string, labels?:boolean, teamColor?:(id:string)=>string}} [o]
   */
  show(mode, def, o = {}) {
    if (mode === 'off' || !def) return this.hide();
    if (!this.group) this._make();
    this.mode = mode; this.def = def; this.sel = o.sel || ''; this.hover = o.hover || '';
    const pos = this.lines.geometry.attributes.position, col = this.lines.geometry.attributes.color, edit = mode === 'editor';
    let n = 0, ln = 0; const b = this._b; this.boxes.clear();
    for (const e of def.entities) {
      if (n >= 320) break;
      if (!edit && !PLAY_VISIBLE.has(e.type)) continue;
      entityBox(def, e, b); this.boxes.set(e.id, b.slice());
      const T0 = ENTITY_TYPES[e.type]; let hex = T0.color;
      if ((e.type === 'spawn' || e.type === 'flag') && e.p.team && o.teamColor) hex = o.teamColor(e.p.team) || hex;
      if (e.type === 'area' && edit) hex = '#38bdf8';
      this._col.set(hex);
      const sel = e.id === this.sel, hov = e.id === this.hover, grow = sel ? 0.04 : 0;
      this._m4.compose(this._v.set((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2), this._q.identity(), this._s.set(b[3] - b[0] + grow, b[4] - b[1] + grow, b[5] - b[2] + grow));
      this.mesh.setMatrixAt(n, this._m4);
      const k = sel ? 1.6 : hov ? 1.3 : 1; this.mesh.setColorAt(n, this._col.clone().multiplyScalar(k));
      // outline
      const lc = sel ? this._col.set('#ffffff') : this._col.set(hex);
      for (const ed of BOX_EDGES) {
        const o0 = ln * 3;
        pos.array[o0] = ed[0] ? b[3] : b[0]; pos.array[o0 + 1] = ed[1] ? b[4] : b[1]; pos.array[o0 + 2] = ed[2] ? b[5] : b[2];
        pos.array[o0 + 3] = ed[3] ? b[3] : b[0]; pos.array[o0 + 4] = ed[4] ? b[4] : b[1]; pos.array[o0 + 5] = ed[5] ? b[5] : b[2];
        col.array[o0] = col.array[o0 + 3] = lc.r; col.array[o0 + 1] = col.array[o0 + 4] = lc.g; col.array[o0 + 2] = col.array[o0 + 5] = lc.b; ln += 2;
      }
      n++;
    }
    this.mesh.count = n; this.mesh.instanceMatrix.needsUpdate = true; if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    pos.needsUpdate = true; col.needsUpdate = true; this.lines.geometry.setDrawRange(0, ln);
    this.mat.opacity = edit ? 0.3 : 0.22;
    this._syncLabels(!!o.labels && edit, def);
  }

  _syncLabels(on, def) {
    const T = this.ctx.THREE;
    if (!on) { for (const s of this.labels.values()) { this.group.remove(s); s.material.map.dispose(); s.material.dispose(); } this.labels.clear(); return; }
    const alive = new Set();
    for (const e of def.entities) {
      const b = this.boxes.get(e.id); if (!b) continue; alive.add(e.id);
      const T0 = ENTITY_TYPES[e.type], text = (e.name || T0.label) + (e.type === 'checkpoint' ? ' ' + e.p.order : ''), key = T0.icon + '|' + text;
      let s = this.labels.get(e.id);
      if (!s || s.userData.key !== key) {
        if (s) { this.group.remove(s); s.material.map.dispose(); s.material.dispose(); }
        const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64; const c = cv.getContext('2d');
        c.fillStyle = 'rgba(8,12,28,.78)'; c.beginPath(); c.roundRect(2, 8, 252, 48, 12); c.fill();
        c.font = '600 26px system-ui, sans-serif'; c.textBaseline = 'middle'; c.fillStyle = '#fff'; c.fillText(T0.icon, 14, 33); c.fillText(text.slice(0, 16), 52, 33);
        const tex = new T.CanvasTexture(cv); tex.minFilter = T.LinearFilter; tex.generateMipmaps = false;
        s = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false })); s.scale.set(3.2, 0.8, 1); s.userData.key = key; s.renderOrder = 8;
        this.group.add(s); this.labels.set(e.id, s);
      }
      s.position.set((b[0] + b[3]) / 2, b[4] + 0.9, (b[2] + b[5]) / 2);
    }
    for (const [id, s] of this.labels) if (!alive.has(id)) { this.group.remove(s); s.material.map.dispose(); s.material.dispose(); this.labels.delete(id); }
  }

  /** Gentle pulse in play mode (one uniform write per frame); editor labels keep a readable size at any distance (10 Hz). */
  update(dt) {
    if (!this.mat) return;
    this._t += dt;
    if (this.mode === 'play') this.mat.opacity = 0.17 + 0.07 * Math.sin(this._t * 2.4);
    else if (this.labels.size && this._t - (this._lt || 0) > 0.1) {
      this._lt = this._t; const c = this.ctx.camera.position;
      for (const s of this.labels.values()) { const k = Math.max(0.28, Math.min(1.5, Math.hypot(s.position.x - c.x, s.position.y - c.y, s.position.z - c.z) / 18)); s.scale.set(3.2 * k, 0.8 * k, 1); }
    }
  }

  /** Entity id under the ray (nearest), or ''. */
  pick(ox, oy, oz, dx, dy, dz, maxDist = 120) {
    let best = '', bd = maxDist;
    for (const [id, b] of this.boxes) { const t = rayBox(ox, oy, oz, dx, dy, dz, b, bd); if (t >= 0 && t < bd) { bd = t; best = id; } }
    return best;
  }

  hide() {
    if (!this.group) { this.mode = 'off'; return; }
    this._syncLabels(false); this.ctx.gr.scene.remove(this.group);
    this.mesh.geometry.dispose(); this.mat.dispose(); this.mesh.dispose(); this.lines.geometry.dispose(); this.lines.material.dispose();
    this.group = null; this.mesh = null; this.lines = null; this.mode = 'off'; this.boxes.clear();
  }
}
