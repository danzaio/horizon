// Procedural voxel bodies for every species (plan + two colours + a feature + evolution stage), a 2D sprite rasteriser for the UI, and the instanced
// renderer that draws wild creatures in the world (reuses the horde vertex/fragment shaders: legs swing, wings flap, "part 7" glows).
import * as THREE from 'three';
import { VS, FS, build, MAX } from '../horde/render.js';
import { SPECIES } from './data.js';

const SCALE = [0.8, 1.0, 1.3];
const sh = (c, k) => c.map((v) => Math.max(0, Math.min(255, Math.round(v * k))));

/** box = [x0,y0,z0,x1,y1,z1,[r,g,b],part]  part: 0 body · 1..4 legs · 5/6 wings · 7 glow */
export function boxesFor(sp) {
  const [A, B] = sp.c, A2 = sh(A, 0.78), B2 = sh(B, 0.85), EYE = [255, 255, 255], bx = [], add = (...a) => bx.push(a);
  switch (sp.plan) {
    case 'quad':
      add(-4, 5, -6, 4, 11, 6, A, 0); add(-3.2, 7.5, -11, 3.2, 13.5, -5.5, A, 0); add(-2, 7.5, -12, 2, 10, -11, B, 0);
      add(-2.2, 9.5, -11.2, -1, 11, -10.6, EYE, 7); add(1, 9.5, -11.2, 2.2, 11, -10.6, EYE, 7);
      add(-4, 0, -5, -1.5, 5.5, -2.5, A2, 1); add(1.5, 0, -5, 4, 5.5, -2.5, A2, 2); add(-4, 0, 2.5, -1.5, 5.5, 5, A2, 3); add(1.5, 0, 2.5, 4, 5.5, 5, A2, 4);
      add(-1, 8, 6, 1, 10, 11, B, 0); break;
    case 'biped':
      add(-3, 6, -3, 3, 13, 3, A, 0); add(-3, 6.5, -3.4, 3, 9, -3, B, 0); add(-3.2, 13, -3.2, 3.2, 19, 3.2, A, 0);
      add(-2, 15, -3.5, -0.8, 16.6, -3.1, EYE, 7); add(0.8, 15, -3.5, 2, 16.6, -3.1, EYE, 7);
      add(-5.5, 7, -1.5, -3, 12, 1.5, A2, 0); add(3, 7, -1.5, 5.5, 12, 1.5, A2, 0);
      add(-3, 0, -2, -0.4, 6, 2, A2, 1); add(0.4, 0, -2, 3, 6, 2, A2, 2); add(-1, 7, 3, 1, 9, 8, B, 0); break;
    case 'flier':
      add(-3, 6, -5, 3, 11, 4, A, 0); add(-2.6, 8, -9, 2.6, 13, -4.6, A, 0); add(-1.2, 8.2, -10.5, 1.2, 9.6, -9, B, 0);
      add(-2, 10.5, -9.2, -0.8, 12, -8.6, EYE, 7); add(0.8, 10.5, -9.2, 2, 12, -8.6, EYE, 7);
      add(-12, 10.4, -3, -3, 11.4, 3.5, B, 5); add(3, 10.4, -3, 12, 11.4, 3.5, B, 6); add(-1.5, 3, -1, -0.2, 6, 1, A2, 0); add(0.2, 3, -1, 1.5, 6, 1, A2, 0); add(-1, 7, 4, 1, 9, 9, B, 0); break;
    case 'serpent':
      for (let i = 0; i < 6; i++) { const w = 3 - i * 0.35, z = -8 + i * 3.2, y = 4 + Math.sin(i * 0.9) * 2; add(-w, y, z, w, y + w * 1.7, z + 3.6, i % 2 ? A2 : A, 0); }
      add(-3.2, 6, -11.5, 3.2, 11, -7.5, A, 0); add(-2, 9, -11.8, -0.8, 10.4, -11.4, EYE, 7); add(0.8, 9, -11.8, 2, 10.4, -11.4, EYE, 7); add(-1, 3, 11, 1, 4.5, 16, B, 0); break;
    default: // blob
      add(-5.5, 1, -5, 5.5, 9, 5, A, 0); add(-4.5, 9, -4, 4.5, 12, 4, A, 0); add(-4, 2, -5.4, 4, 4.5, -5, B, 0);
      add(-3, 7, -5.4, -1.4, 9, -5, EYE, 7); add(1.4, 7, -5.4, 3, 9, -5, EYE, 7); add(-5.9, 3, -1, -5.5, 6, 1, B, 0); add(5.5, 3, -1, 5.9, 6, 1, B, 0);
  }
  const top = sp.plan === 'flier' ? 13 : sp.plan === 'biped' ? 19 : sp.plan === 'blob' ? 12 : sp.plan === 'serpent' ? 12 : 13.5, front = sp.plan === 'flier' ? -9 : sp.plan === 'biped' ? -3 : sp.plan === 'blob' ? -5 : -7;
  switch (sp.feat) {
    case 'flame': add(-1.5, 9, 10, 1.5, 13, 13, [255, 120, 30], 7); add(-0.8, 12, 11, 0.8, 16, 12.5, [255, 220, 90], 7); break;
    case 'leaf': add(-0.5, top, front + 3, 0.5, top + 3, front + 4, [60, 160, 70], 0); add(-3, top, front + 3, -0.6, top + 1.2, front + 6, B, 0); add(0.6, top, front + 3, 3, top + 1.2, front + 6, B, 0); break;
    case 'fin': add(-0.5, top, -1, 0.5, top + 4, 3, B, 0); break;
    case 'bolt': add(-1, 8, 6, 1, 10, 9, B, 7); add(-1, 10, 8, 1, 12, 11, B, 7); add(-1, 12, 10, 1, 15, 13, B, 7); break;
    case 'shell': add(-4.5, 11, -4, 4.5, 14, 5, B2, 0); add(-3, 14, -2, 3, 15.5, 3, B, 0); break;
    case 'crystal': add(-2, top, front + 1, -0.8, top + 4, front + 2.4, B, 7); add(0.8, top, front + 2, 2, top + 3, front + 3.4, B, 7); add(-0.5, top, front + 4, 0.5, top + 5, front + 5, B, 7); break;
    case 'ears': add(-2.6, top, front + 2, -1.2, top + 5, front + 3.4, A, 0); add(1.2, top, front + 2, 2.6, top + 5, front + 3.4, A, 0); add(-2.4, top + 0.5, front + 2.2, -1.4, top + 4, front + 3.2, B, 0); break;
    case 'wings': add(-14, 10.2, -3, -12, 11.6, 4, B, 5); add(12, 10.2, -3, 14, 11.6, 4, B, 6); break;
    case 'cap': add(-6.5, 11, -6.5, 6.5, 14, 6.5, A, 0); add(-1.5, 14, -1.5, 1.5, 15, 1.5, B, 0); add(-4, 14, -4, -2, 15, -2, B, 0); add(2, 14, 2, 4, 15, 4, B, 0); break;
    case 'horn': add(-0.9, top, front + 1, 0.9, top + 3.5, front + 2.6, B, 0); break;
    default: break;
  }
  if (sp.stage >= 1) { add(-0.8, top - 1, front + 5, 0.8, top + 1.5, front + 6.5, B, 0); add(-0.8, top - 2, front + 8, 0.8, top + 1, front + 9.5, B, 0); }
  if (sp.stage >= 2) { add(-0.8, top - 3, front + 11, 0.8, top, front + 12.5, B, 0); add(-5.2, 8.5, -2, -4.2, 12.5, 2, B, 0); add(4.2, 8.5, -2, 5.2, 12.5, 2, B, 0); }
  if (sp.legend) { add(-1, top + 2, front + 1, 1, top + 7, front + 2, [255, 240, 160], 7); }
  return bx;
}

// ---- 2D sprite (isometric painter) for the party / battle screens --------------------------------------------------
const spriteCache = new Map();
export function drawSprite(canvas, spId, yaw = -0.7, size = 96) {
  const key = spId + ':' + yaw + ':' + size; let src = spriteCache.get(key);
  if (!src) {
    src = document.createElement('canvas'); src.width = src.height = size; const g = src.getContext('2d'); g.imageSmoothingEnabled = false;
    const sp = SPECIES[spId], boxes = boxesFor(sp), cy = Math.cos(yaw), sy = Math.sin(yaw), pit = 0.45, cp = Math.cos(pit), sp2 = Math.sin(pit), S = size / 34 * (sp.stage === 2 ? 0.85 : sp.stage === 0 ? 1.05 : 0.95);
    const P = (x, y, z) => { const xr = x * cy + z * sy, zr = -x * sy + z * cy; return [size / 2 + xr * S, size * 0.84 - (y * cp + zr * sp2) * S, zr]; };
    const items = boxes.map((b) => ({ b, d: P((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2)[2] })).sort((p, q) => q.d - p.d);
    for (const { b } of items) {
      const [x0, y0, z0, x1, y1, z1, c, part] = b, glow = part === 7;
      const faces = [ // [normal, corners]
        [[0, 1, 0], [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], 1.0], [[0, 0, 1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], 0.78], [[0, 0, -1], [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], 0.78],
        [[1, 0, 0], [[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]], 0.64], [[-1, 0, 0], [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], 0.64],
      ];
      for (const [n, cs, k] of faces) {
        const nrz = -n[0] * sy + n[2] * cy; if (n[1] * sp2 - nrz * cp <= 0.001) continue;              // facing away from the (high, front) camera
        const col = sh(c, glow ? 1.15 : k); g.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`; g.beginPath(); cs.forEach((q, i) => { const p = P(q[0], q[1], q[2]); if (i) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); }); g.closePath(); g.fill();
        g.strokeStyle = 'rgba(0,0,0,.28)'; g.lineWidth = 0.6; g.stroke();
      }
    }
    spriteCache.set(key, src);
  }
  canvas.width = canvas.height = size; const g2 = canvas.getContext('2d'); g2.clearRect(0, 0, size, size); g2.drawImage(src, 0, 0);
}

// ---- world renderer ------------------------------------------------------------------------------------------------
export class CritterRender {
  constructor(shared, scene) {
    this.scene = scene; this.group = new THREE.Group(); scene.add(this.group); this.meshes = new Map(); this._post = null;
    this.material = new THREE.ShaderMaterial({ uniforms: Object.assign({}, shared), vertexShader: VS, fragmentShader: FS, side: THREE.FrontSide });
  }
  _mesh(spId) {
    let m = this.meshes.get(spId); if (m) return m;
    const sp = SPECIES[spId], b = build({ boxes: boxesFor(sp) }), g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3)); g.setAttribute('aN', new THREE.Float32BufferAttribute(b.nrm, 3)); g.setAttribute('aC', new THREE.Float32BufferAttribute(b.col, 3)); g.setAttribute('aPiv', new THREE.Float32BufferAttribute(b.piv, 4)); g.setIndex(b.idx);
    const a = new Float32Array(16 * 4), bb = new Float32Array(16 * 4), ia = new THREE.InstancedBufferAttribute(a, 4), ib = new THREE.InstancedBufferAttribute(bb, 4); ia.setUsage(THREE.DynamicDrawUsage); ib.setUsage(THREE.DynamicDrawUsage); g.setAttribute('iA', ia); g.setAttribute('iB', ib); g.instanceCount = 0; g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    const mesh = new THREE.Mesh(g, this.material); mesh.frustumCulled = false; mesh.matrixAutoUpdate = false; this.group.add(mesh); m = { mesh, a, b: bb, ia, ib, n: 0 }; this.meshes.set(spId, m); return m;
  }
  update(list, cam, post) {
    if (post !== this._post) { this._post = post; this.material.defines = post ? {} : { NO_POST: 1 }; this.material.needsUpdate = true; }
    for (const m of this.meshes.values()) m.n = 0;
    for (const c of list) { const m = this._mesh(c.sp), k = m.n; if (k >= 16) continue; m.n++; const o = k * 4; m.a[o] = c.x - cam.x; m.a[o + 1] = c.y - cam.y; m.a[o + 2] = c.z - cam.z; m.a[o + 3] = c.yaw; m.b[o] = c.phase; m.b[o + 1] = c.moving; m.b[o + 2] = SCALE[SPECIES[c.sp].stage] * (c.big || 1); m.b[o + 3] = c.flash; }
    for (const m of this.meshes.values()) { m.mesh.geometry.instanceCount = m.n; m.mesh.visible = m.n > 0; if (m.n) { m.ia.needsUpdate = true; m.ib.needsUpdate = true; } }
  }
  dispose() { this.group.removeFromParent(); for (const m of this.meshes.values()) m.mesh.geometry.dispose(); this.material.dispose(); }
}
export { MAX };
