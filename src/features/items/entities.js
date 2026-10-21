// Entity layer: projectiles, falling blocks, primed TNT, dropped items, the gravity-gun's held block and explosion shockwaves.
// Pooled (<= CAP), simple AABB physics against world.getBlock, instanced rendering (camera-relative float64 -> float32, like Mobs),
// and ZERO cost while empty (update() returns before touching anything).
import * as THREE from 'three';
import { TILE_FACE, RENDER, RENDER_CROSS, TINT, TINT_GRASS, TINT_FOLIAGE, CUTOUT, EMIT, SOLID, B } from '../../shared/blocks.js';
import { UNIFORMS, NOISE, SKY_FN, FOG_FN, LIGHT_FN, TONEMAP_FN, OUTPUT } from '../../render/shaders/common.js';

/** entity kinds */
export const K = { ARROW: 1, SNOW: 2, FALL: 3, TNT: 4, DROP: 5, HELD: 6, ROCKET: 7, PEARL: 8, PROP: 9, MISSILE: 10, GRENADE: 11, MINE: 12, BEAM: 13 };
const CAP = 128, GRAV = { [K.ARROW]: 20, [K.SNOW]: 16, [K.PEARL]: 18, [K.ROCKET]: 0, [K.MISSILE]: 0 };

const FACE_N = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const FACE_C = [ // CCW corners seen from outside (same winding as Hand.js)
  [[.5, -.5, .5], [.5, -.5, -.5], [.5, .5, -.5], [.5, .5, .5]], [[-.5, -.5, -.5], [-.5, -.5, .5], [-.5, .5, .5], [-.5, .5, -.5]],
  [[-.5, .5, .5], [.5, .5, .5], [.5, .5, -.5], [-.5, .5, -.5]], [[-.5, -.5, -.5], [.5, -.5, -.5], [.5, -.5, .5], [-.5, -.5, .5]],
  [[-.5, -.5, .5], [.5, -.5, .5], [.5, .5, .5], [-.5, .5, .5]], [[.5, -.5, -.5], [-.5, -.5, -.5], [-.5, .5, -.5], [.5, .5, -.5]],
];
const UVS = [[0, 0], [1, 0], [1, 1], [0, 1]];

function cubeGeometry(id) {
  const pos = [], nrm = [], uv = [], lay = [], idx = [];
  for (let f = 0; f < 6; f++) {
    const base = pos.length / 3;
    for (let c = 0; c < 4; c++) { pos.push(...FACE_C[f][c]); nrm.push(...FACE_N[f]); uv.push(...UVS[c]); lay.push(id >= 0 ? TILE_FACE[id * 6 + f] : 0); }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aN', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aUv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('aLayer', new THREE.Float32BufferAttribute(lay, 1)); g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  return g;
}

const VS_COMMON = /* glsl */`
attribute vec3 aN; attribute vec2 aUv; attribute float aLayer;
varying vec2 vUv; flat varying float vLayer; varying vec3 vN; varying vec3 vRel; varying vec3 vInst;
void main(){
  vec4 w = instanceMatrix * vec4(position, 1.0);
  vRel = w.xyz; vUv = aUv; vLayer = aLayer; vInst = instanceColor;
  vN = normalize(mat3(instanceMatrix) * aN);
  gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * w.xyz, 1.0);
}`;
const FS_HEAD = /* glsl */`
${UNIFORMS}
${NOISE}
${SKY_FN}
${FOG_FN}
${LIGHT_FN}
${TONEMAP_FN}
uniform sampler2DArray uTiles; uniform vec3 uTint; uniform float uCut; uniform float uUseTex; uniform float uEmit;
varying vec2 vUv; flat varying float vLayer; varying vec3 vN; varying vec3 vRel; varying vec3 vInst;
void main(){
  vec3 alb; vec3 n = normalize(vN);
  if (uUseTex > 0.5) {
    vec4 t = texture(uTiles, vec3(vUv, vLayer));
    if (uCut > 0.5 && t.a < 0.45) discard;
    alb = srgb2lin(t.rgb * mix(vec3(1.0), uTint, mix(t.a, 1.0, uCut)));
  } else alb = srgb2lin(vInst);
  float flash = uUseTex > 0.5 ? vInst.x : 0.0;
  float ndl = max(dot(n, uKeyDir), 0.0);
  vec3 col = alb * lightTerm(n.y, 0.9, ndl, 0.95, uEmit, 1.0, 1.0);
  if (uHeld.a > 0.0) col += alb * heldLight(vRel, n, 1.0, 1.0);
  col = mix(col, vec3(2.6, 2.4, 2.2), flash);
  col = applyFog(col, vRel);
  float outAlpha = 1.0;
  ${OUTPUT}
}`;

const BLAST_VS = /* glsl */`
varying vec3 vN; varying vec3 vRel;
void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vRel = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * w.xyz, 1.0); }`;
const BLAST_FS = /* glsl */`
${UNIFORMS}
${NOISE}
${TONEMAP_FN}
uniform float uA; uniform float uK;
varying vec3 vN; varying vec3 vRel;
void main(){
  float f = pow(1.0 - abs(dot(normalize(vN), normalize(-vRel))), 1.4);
  vec3 col = mix(vec3(1.0, 0.55, 0.14), vec3(1.0, 0.2, 0.04), uK) * (0.06 + f * 1.15) * uA;
  #ifdef NO_POST
    col = finalColor(col, gl_FragCoord.xy);
  #endif
  gl_FragColor = vec4(col, 1.0);
}`;

const mk = () => ({ on: false, k: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, life: 0, r: 0.25, block: 0, c: [1, 1, 1], owner: null, vis: false, stuck: false, spin: 0, data: null, flash: 0, grounded: false, hitSet: 0, dmg: 0, kb: 0, held: false });

export class Entities {
  /** @param {{gr:object, world:object, ctx:object}} S  gr = GameRenderer, world = World */
  constructor(S) {
    this.S = S; this.world = S.world; this.gr = S.gr;
    this.list = Array.from({ length: CAP }, mk); this.count = 0; this._free = CAP; this._next = 0;
    this.group = new THREE.Group(); this.group.visible = false; S.gr.scene.add(this.group);
    this.shown = false; this.post = null;
    this._uShared = Object.assign({}, S.gr.shared);
    // coloured instanced cubes (arrows, drops, snowballs, …)
    this.cubeMat = this._material({ uUseTex: 0 });
    this.cube = this._instanced(cubeGeometry(-1), this.cubeMat, CAP * 2);
    this.blockMeshes = new Map();
    const bg = new THREE.SphereGeometry(0.5, 12, 9);
    bg.setAttribute('aN', bg.getAttribute('normal')); bg.setAttribute('aUv', bg.getAttribute('uv')); bg.setAttribute('aLayer', new THREE.Float32BufferAttribute(new Float32Array(bg.getAttribute('position').count), 1));
    bg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.ballMesh = this._instanced(bg, this.cubeMat, 32);   // bouncy balls (prop gun)
    // shockwaves
    this.blasts = []; this.blastsLive = 0;
    const sg = new THREE.SphereGeometry(1, 14, 10);
    this.blastMat = new THREE.ShaderMaterial({ uniforms: Object.assign({ uA: { value: 1 }, uK: { value: 0 } }, this._uShared), vertexShader: BLAST_VS, fragmentShader: BLAST_FS, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.FrontSide });
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(sg, this.blastMat.clone()); m.frustumCulled = false; m.visible = false; this.group.add(m);
      this.blasts.push({ m, t: 0, dur: 0.5, R: 1, x: 0, y: 0, z: 0, on: false });
    }
    // reusable temporaries (no per-frame allocation)
    this._q = new THREE.Quaternion(); this._m4 = new THREE.Matrix4(); this._v = new THREE.Vector3(); this._s = new THREE.Vector3(); this._d = new THREE.Vector3(); this._o = new THREE.Vector3();
    this._z = new THREE.Vector3(0, 0, 1);
    // hooks (assigned by the items runtime)
    this.onProjectile = null;     // (e, ax,ay,az, bx,by,bz, maxT) => boolean  (true = consumed by a living target)
    this.onBody = null;           // (e) => void  a fast falling block may hurt whatever it overlaps
    this.onBlockImpact = null;    // (e, hit) => void
    this.onFallLand = null;       // (e, x, y, z) => void   block cell where the falling block ends up
    this.onFuse = null;           // (e) => void            primed TNT ran out
    this.onPickup = null;         // (e) => boolean
    this.onExpire = null;         // (e) => void            rockets, pearls …
    this.onMine = null;           // (e) => void            every frame for each mine (arming / proximity)
  }

  _material(extra) {
    const m = new THREE.ShaderMaterial({
      uniforms: Object.assign({ uTiles: { value: this.gr.tiles }, uTint: { value: new THREE.Vector3(1, 1, 1) }, uCut: { value: 0 }, uUseTex: { value: 0 }, uEmit: { value: 0 } }, this._uShared),
      vertexShader: VS_COMMON, fragmentShader: FS_HEAD, side: THREE.FrontSide,
    });
    for (const k in extra) m.uniforms[k].value = extra[k];
    return m;
  }

  _instanced(geo, mat, cap) {
    const im = new THREE.InstancedMesh(geo, mat, cap);
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3); im.instanceColor.setUsage(THREE.DynamicDrawUsage);
    im.frustumCulled = false; im.count = 0; im.visible = false; this.group.add(im);
    return im;
  }

  _blockMesh(id) {
    let m = this.blockMeshes.get(id);
    if (m) return m;
    const mat = this._material({ uUseTex: 1, uCut: CUTOUT[id] ? 1 : 0, uEmit: EMIT[id] > 0 ? 0.6 : 0 });
    const t = TINT[id]; mat.uniforms.uTint.value.set(...(t === TINT_GRASS ? [0.5, 0.74, 0.31] : t === TINT_FOLIAGE ? [0.36, 0.61, 0.2] : [1, 1, 1]));
    if (this.post === false) mat.defines = { NO_POST: 1 };
    m = this._instanced(cubeGeometry(RENDER[id] === RENDER_CROSS || RENDER[id] === 0 ? B.STONE : id), mat, 48);
    this.blockMeshes.set(id, m);
    return m;
  }

  /** Reserve an entity. Returns null when the pool is full and nothing can be recycled. */
  spawn(k, x, y, z, vx = 0, vy = 0, vz = 0, o = null) {
    let e = null;
    for (let n = 0; n < CAP; n++) { const c = this.list[(this._next + n) % CAP]; if (!c.on) { e = c; this._next = (this._next + n + 1) % CAP; break; } }
    if (!e) { // recycle the oldest stuck arrow / drop
      let best = null; for (const c of this.list) if ((c.k === K.ARROW && c.stuck || c.k === K.DROP) && (!best || c.age > best.age)) best = c;
      if (!best) return null; e = best; this.count--;
    }
    e.on = true; e.k = k; e.x = x; e.y = y; e.z = z; e.vx = vx; e.vy = vy; e.vz = vz; e.age = 0; e.life = 30; e.r = 0.25; e.block = 0; e.owner = null; e.vis = false; e.stuck = false;
    e.spin = Math.random() * 6.28; e.data = null; e.flash = 0; e.grounded = false; e.hitSet = 0; e.dmg = 0; e.kb = 0; e.held = false; e.c[0] = e.c[1] = e.c[2] = 1;
    if (o) Object.assign(e, o);
    this.count++;
    return e;
  }

  kill(e) { if (e.on) { e.on = false; this.count--; } }

  /** shockwave sphere at (x,y,z) with final radius R */
  blast(x, y, z, R, dur = 0.5, hot = 0) {
    let b = this.blasts.find((q) => !q.on); if (!b) b = this.blasts[0];
    b.on = true; b.t = 0; b.dur = dur; b.R = R; b.x = x; b.y = y; b.z = z; b.m.material.uniforms.uK.value = hot; b.m.visible = true; this.blastsLive++; this.group.visible = true; this.shown = true;
  }

  // ---- collision helpers -------------------------------------------------------------------------------------------
  _solid(x, y, z) { const b = this.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)); return SOLID[b] === 1; }
  _boxHits(x, y, z, r, hy) {
    const x0 = Math.floor(x - r), x1 = Math.floor(x + r), z0 = Math.floor(z - r), z1 = Math.floor(z + r), y0 = Math.floor(y - hy), y1 = Math.floor(y + hy), w = this.world;
    for (let yy = y0; yy <= y1; yy++) for (let zz = z0; zz <= z1; zz++) for (let xx = x0; xx <= x1; xx++) if (SOLID[w.getBlock(xx, yy, zz)] === 1) return true;
    return false;
  }

  // ---- simulation + rendering --------------------------------------------------------------------------------------
  update(dt, cam) {
    if (this.count === 0 && this.blastsLive === 0) { if (this.shown) { this.shown = false; this.group.visible = false; for (const m of this.blockMeshes.values()) m.visible = false; this.cube.visible = false; this.ballMesh.visible = false; } return; }
    const post = !!this.gr.post;
    if (post !== this.post) { this.post = post; const d = post ? {} : { NO_POST: 1 }; for (const mat of [this.cubeMat, this.blastMat, ...[...this.blockMeshes.values()].map((m) => m.material), ...this.blasts.map((b) => b.m.material)]) { mat.defines = Object.assign({}, d); mat.needsUpdate = true; } }
    this.shown = true; this.group.visible = true;
    dt = Math.min(dt, 0.05);
    for (const m of this.blockMeshes.values()) m.count = 0;
    this.cube.count = 0; this.ballMesh.count = 0;
    const L = this.list;
    for (let i = 0; i < CAP; i++) { const e = L[i]; if (!e.on) continue; this._step(e, dt); if (e.on) this._draw(e, cam); }
    for (const m of this.blockMeshes.values()) { m.visible = m.count > 0; if (m.visible) { m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; } }
    this.cube.visible = this.cube.count > 0;
    if (this.cube.visible) { this.cube.instanceMatrix.needsUpdate = true; this.cube.instanceColor.needsUpdate = true; }
    this.ballMesh.visible = this.ballMesh.count > 0;
    if (this.ballMesh.visible) { this.ballMesh.instanceMatrix.needsUpdate = true; this.ballMesh.instanceColor.needsUpdate = true; }
    if (this.blastsLive > 0) this._blasts(dt, cam);
  }

  _blasts(dt, cam) {
    for (const b of this.blasts) {
      if (!b.on) continue;
      b.t += dt; const u = b.t / b.dur;
      if (u >= 1) { b.on = false; b.m.visible = false; this.blastsLive--; continue; }
      const ease = 1 - (1 - u) * (1 - u), s = b.R * (0.25 + 0.95 * ease);
      b.m.position.set(b.x - cam.x, b.y - cam.y, b.z - cam.z); b.m.scale.setScalar(s);
      b.m.material.uniforms.uA.value = (1 - u) * (1 - u) * 1.1;
    }
  }

  _step(e, dt) {
    e.age += dt;
    if (e.k !== K.HELD && e.k !== K.TNT && e.k !== K.GRENADE && e.age > e.life) { if (e.k !== K.BEAM && this.onExpire) this.onExpire(e); this.kill(e); return; }
    const w = this.world;
    switch (e.k) {
      case K.ARROW: case K.SNOW: case K.PEARL: case K.ROCKET: case K.MISSILE: {
        if (e.stuck) return;
        if (w.getBlock(Math.floor(e.x), Math.floor(e.y), Math.floor(e.z)) === B.UNLOADED) { if (e.age > 4) this.kill(e); return; }
        if (e.k === K.ROCKET) { e.vy = Math.min(e.vy + 22 * dt, 16); e.vx *= 1 - dt * 0.4; e.vz *= 1 - dt * 0.4; }
        else e.vy -= GRAV[e.k] * dt;
        if (e.k === K.MISSILE) { const sp = Math.hypot(e.vx, e.vy, e.vz), k = Math.min(1, 1 + dt * 0.9); if (sp < 46) { e.vx *= k; e.vy *= k; e.vz *= k; } e.hitSet -= dt; if (e.hitSet <= 0) { e.hitSet = 0.025; this.S.ctx.interaction.particles.burst(e.x - e.vx * 0.02, e.y - e.vy * 0.02, e.z - e.vz * 0.02, e.age < 0.1 ? [1, 0.8, 0.3] : [0.55, 0.52, 0.5], 1, 0.35); } }
        const ax = e.x, ay = e.y, az = e.z, bx = ax + e.vx * dt, by = ay + e.vy * dt, bz = az + e.vz * dt;
        const dx = bx - ax, dy = by - ay, dz = bz - az, len = Math.hypot(dx, dy, dz) || 1e-6;
        const o = this._o, d = this._d; o.set(ax, ay, az); d.set(dx / len, dy / len, dz / len);
        const hit = w.raycast(o, d, len);
        const maxT = hit ? hit.dist : len;
        if (this.onProjectile && !e.vis && this.onProjectile(e, ax, ay, az, ax + d.x * maxT, ay + d.y * maxT, az + d.z * maxT, maxT)) { this.kill(e); return; }
        if (hit) {
          e.x = ax + d.x * Math.max(0, hit.dist - 0.02); e.y = ay + d.y * Math.max(0, hit.dist - 0.02); e.z = az + d.z * Math.max(0, hit.dist - 0.02);
          if (this.onBlockImpact) this.onBlockImpact(e, hit);
          if (e.on && e.k === K.ARROW) { e.stuck = true; e.age = 0; e.life = 45; e.vx = e.vy = e.vz = 0; e.data = [d.x, d.y, d.z]; }
          else this.kill(e);
          return;
        }
        e.x = bx; e.y = by; e.z = bz;
        if (e.y < -30) this.kill(e);
        break;
      }
      case K.MINE: { if (this.onMine) this.onMine(e); e.flash = e.age > 1 && Math.floor(e.age * 2) % 2 === 0 ? 1 : 0; if (!this._solid(e.x, e.y - 0.1, e.z) && e.age > 0.2) this.kill(e); break; }
      case K.BEAM: break;
      case K.FALL: case K.TNT: case K.DROP: case K.GRENADE: {
        if (w.getBlock(Math.floor(e.x), Math.floor(e.y), Math.floor(e.z)) === B.UNLOADED) return;
        e.vy = Math.max(-45, e.vy - 28 * dt);
        const r = e.r, hy = e.k === K.DROP ? 0.12 : r;
        let nx = e.x + e.vx * dt;
        if (this._boxHits(nx, e.y, e.z, r, hy - 0.01)) { if (e.k === K.FALL && Math.abs(e.vx) > 4) { this._landFall(e); return; } e.vx *= e.k === K.GRENADE ? -0.55 : -0.2; nx = e.x; }
        e.x = nx;
        let nz = e.z + e.vz * dt;
        if (this._boxHits(e.x, e.y, nz, r, hy - 0.01)) { if (e.k === K.FALL && Math.abs(e.vz) > 4) { this._landFall(e); return; } e.vz *= e.k === K.GRENADE ? -0.55 : -0.2; nz = e.z; }
        e.z = nz;
        const ny = e.y + e.vy * dt;
        if (this._boxHits(e.x, ny, e.z, r, hy)) {
          if (e.k === K.FALL) { this._landFall(e); return; }
          if (e.vy < -3 && (e.k === K.TNT || e.k === K.GRENADE)) { e.vy *= e.k === K.GRENADE ? -0.5 : -0.3; } else e.vy = 0;
          e.grounded = true; const f = Math.exp(-6 * dt); e.vx *= f; e.vz *= f;
        } else { e.y = ny; e.grounded = false; }
        if (e.k === K.GRENADE) { e.flash = ((e.life - e.age) < 0.7 ? Math.floor(e.age * 16) % 2 : Math.floor(e.age * 6) % 2) ? 1 : 0; if (e.age >= e.life) { if (this.onFuse) this.onFuse(e); this.kill(e); } }
        else if (e.k === K.TNT) { e.flash = ((e.life - e.age) < 0.8 ? Math.floor(e.age * 14) % 2 : Math.floor(e.age * 5) % 2) ? 1 : 0; if (e.age >= e.life) { if (this.onFuse) this.onFuse(e); this.kill(e); } }
        else if (e.k === K.DROP) { e.spin += dt * 2.5; if (this.onPickup && e.age > 0.5 && this.onPickup(e)) this.kill(e); }
        else if (e.k === K.FALL) { if (this.onBody && e.age > 0.08 && e.vx * e.vx + e.vy * e.vy + e.vz * e.vz > 36) this.onBody(e); }
        break;
      }
      case K.PROP: { // bouncing / rolling physics props (prop gun); `held` = carried by the gravity gun
        if (e.held || w.getBlock(Math.floor(e.x), Math.floor(e.y), Math.floor(e.z)) === B.UNLOADED) return;
        const r = e.r, rest = e.data === 'ball' ? 0.62 : 0.16, p = this.S.ctx.player;
        const pdx = e.x - p.x, pdz = e.z - p.z, pd = Math.hypot(pdx, pdz);
        if (pd < r + 0.4 && p.y < e.y + r && p.y + 1.8 > e.y - r) { const k = Math.min(1, dt * 10) / (pd || 1); e.vx += (pdx * 3 + p.vx * 0.8 * (pd || 1) - e.vx * (pd || 1)) * k; e.vz += (pdz * 3 + p.vz * 0.8 * (pd || 1) - e.vz * (pd || 1)) * k; }
        e.vy = Math.max(-45, e.vy - 28 * dt);
        let nx = e.x + e.vx * dt; if (this._boxHits(nx, e.y, e.z, r, r - 0.02)) { e.vx *= -rest; nx = e.x; } e.x = nx;
        let nz = e.z + e.vz * dt; if (this._boxHits(e.x, e.y, nz, r, r - 0.02)) { e.vz *= -rest; nz = e.z; } e.z = nz;
        const ny = e.y + e.vy * dt;
        if (this._boxHits(e.x, ny, e.z, r, r)) { if (e.vy < -2.5) { e.vy *= -rest; if (e.vy < 1) e.vy = 0; } else e.vy = 0; const f = Math.exp(-(e.data === 'ball' ? 0.5 : 5) * dt); e.vx *= f; e.vz *= f; }
        else e.y = ny;
        e.spin += Math.hypot(e.vx, e.vz) * dt / r;
        break;
      }
      default: break; // HELD: positioned by the gravity gun
    }
  }

  _landFall(e) {
    const cx = Math.floor(e.x), cy = Math.floor(e.y + 0.3), cz = Math.floor(e.z);
    this.kill(e);
    if (this.onFallLand) this.onFallLand(e, cx, cy, cz);
  }

  _draw(e, cam) {
    const rx = e.x - cam.x, ry = e.y - cam.y, rz = e.z - cam.z, v = this._v, q = this._q, s = this._s;
    switch (e.k) {
      case K.ARROW: case K.ROCKET: case K.PEARL: case K.SNOW: {
        if (e.k === K.SNOW || e.k === K.PEARL) { const sz = e.k === K.SNOW ? 0.2 : 0.22; q.identity(); v.set(rx, ry, rz); s.set(sz, sz, sz); this._putCube(v, q, s, e.k === K.SNOW ? 0.96 : 0.2, e.k === K.SNOW ? 0.98 : 0.8, e.k === K.SNOW ? 1 : 0.75); break; }
        let dx, dy, dz;
        if (e.stuck && e.data) { dx = e.data[0]; dy = e.data[1]; dz = e.data[2]; } else { const l = Math.hypot(e.vx, e.vy, e.vz) || 1; dx = e.vx / l; dy = e.vy / l; dz = e.vz / l; }
        q.setFromUnitVectors(this._z, this._d.set(dx, dy, dz));
        if (e.k === K.ROCKET) { v.set(rx, ry, rz); s.set(0.11, 0.11, 0.55); this._putCube(v, q, s, 0.85, 0.15, 0.12); v.set(rx - dx * 0.34, ry - dy * 0.34, rz - dz * 0.34); s.set(0.07, 0.07, 0.2); this._putCube(v, q, s, 1, 0.8, 0.3); break; }
        v.set(rx - dx * 0.2, ry - dy * 0.2, rz - dz * 0.2); s.set(0.05, 0.05, 0.9); this._putCube(v, q, s, 0.62, 0.5, 0.34);       // shaft
        v.set(rx + dx * 0.3, ry + dy * 0.3, rz + dz * 0.3); s.set(0.1, 0.1, 0.14); this._putCube(v, q, s, 0.62, 0.66, 0.7);          // head
        v.set(rx - dx * 0.6, ry - dy * 0.6, rz - dz * 0.6); s.set(0.12, 0.012, 0.16); this._putCube(v, q, s, 0.9, 0.9, 0.88);         // fletching
        break;
      }
      case K.GRENADE: { q.setFromAxisAngle(this._d.set(0.3, 1, 0.2).normalize(), e.age * 6); v.set(rx, ry, rz); s.set(0.26, 0.3, 0.26); this._putCube(v, q, s, e.flash ? 1.8 : 0.18, e.flash ? 0.3 : 0.26, e.flash ? 0.2 : 0.16); break; }
      case K.MINE: { q.identity(); v.set(rx, ry + 0.07, rz); s.set(0.62, 0.14, 0.62); this._putCube(v, q, s, 0.2, 0.22, 0.2); v.set(rx, ry + 0.17, rz); s.set(0.14, 0.06, 0.14); this._putCube(v, q, s, e.flash ? 2.2 : 0.35, e.flash ? 0.15 : 0.05, 0.05); break; }
      case K.BEAM: {
        const d = e.data, k = 1 - e.age / e.life, ex = d[0] - cam.x, ey = d[1] - cam.y, ez = d[2] - cam.z, dx = ex - rx, dy = ey - ry, dz = ez - rz, L = Math.hypot(dx, dy, dz) || 1e-3;
        q.setFromUnitVectors(this._z, this._d.set(dx / L, dy / L, dz / L)); v.set(rx + dx / 2, ry + dy / 2, rz + dz / 2); s.set(e.r * k, e.r * k, L); this._putCube(v, q, s, e.c[0], e.c[1], e.c[2]); break;
      }
      case K.DROP: {
        const bob = Math.sin(e.age * 3 + e.spin) * 0.05 + 0.18, sz = 0.28;
        q.setFromAxisAngle(this._d.set(0, 1, 0), e.spin); v.set(rx, ry + bob, rz); s.set(sz, sz, sz);
        if (e.block) this._putBlock(e.block, v, q, s, 0); else this._putCube(v, q, s, e.c[0], e.c[1], e.c[2]);
        break;
      }
      case K.PROP: {
        if (e.data === 'ball') {
          if (e.vx * e.vx + e.vz * e.vz > 0.01) q.setFromAxisAngle(this._d.set(e.vz, 0, -e.vx).normalize(), e.spin); else q.identity();
          v.set(rx, ry, rz); s.setScalar(e.r * 2);
          const bm = this.ballMesh, i = bm.count; if (i >= 32) break; bm.count++;
          this._m4.compose(v, q, s); this._m4.toArray(bm.instanceMatrix.array, i * 16);
          bm.instanceColor.array[i * 3] = e.c[0]; bm.instanceColor.array[i * 3 + 1] = e.c[1]; bm.instanceColor.array[i * 3 + 2] = e.c[2];
        } else { q.setFromAxisAngle(this._d.set(0, 1, 0), e.hitSet * 0.7); v.set(rx, ry, rz); s.setScalar(e.r * 2); this._putBlock(e.data === 'barrel' ? B.LOG_OAK : B.PLANKS, v, q, s, 0); }
        break;
      }
      default: { // FALL, TNT, HELD
        const sz = e.k === K.HELD ? 0.62 : e.k === K.TNT ? 0.98 : 0.98;
        q.setFromAxisAngle(this._d.set(0.4, 1, 0.3).normalize(), e.k === K.HELD ? e.spin : 0);
        v.set(rx, ry, rz); s.set(sz, sz, sz);
        this._putBlock(e.block || B.STONE, v, q, s, e.flash);
      }
    }
  }

  _putCube(pos, q, sc, r, g, b) {
    const c = this.cube, i = c.count++;
    this._m4.compose(pos, q, sc); this._m4.toArray(c.instanceMatrix.array, i * 16);
    c.instanceColor.array[i * 3] = r; c.instanceColor.array[i * 3 + 1] = g; c.instanceColor.array[i * 3 + 2] = b;
  }

  _putBlock(id, pos, q, sc, flash) {
    const c = this._blockMesh(id);
    if (c.count >= 48) return;
    const i = c.count++;
    this._m4.compose(pos, q, sc); this._m4.toArray(c.instanceMatrix.array, i * 16);
    c.instanceColor.array[i * 3] = flash; c.instanceColor.array[i * 3 + 1] = 0; c.instanceColor.array[i * 3 + 2] = 0;
  }

  dispose() {
    this.group.removeFromParent();
    this.cube.geometry.dispose(); this.cubeMat.dispose(); this.blastMat.dispose();
    for (const m of this.blockMeshes.values()) { m.geometry.dispose(); m.material.dispose(); }
  }
}
