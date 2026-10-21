// Interaction: reach-6 raycast, block highlight, timed breaking with crack overlay, placing, picking, break particles.
import * as THREE from 'three';
import { B, BLOCKS, RENDER_CROSS, RENDER, LIQUID, SOLID } from '../shared/blocks.js';
import { WORLD_HEIGHT } from '../shared/constants.js';
import { Particles } from './Particles.js';
import { blockColor } from './blockColors.js';

const REACH = 6;
// seconds to break (hold LMB); Infinity = unbreakable
const HARDNESS = { stone: 0.9, cobblestone: 0.9, bricks: 0.9, sandstone: 0.7, coal_ore: 1.1, iron_ore: 1.3, gold_ore: 1.3, diamond_ore: 1.6, bedrock: Infinity,
  dirt: 0.35, grass: 0.4, snowy_grass: 0.4, sand: 0.3, gravel: 0.35, snow: 0.2, ice: 0.3, oak_log: 0.7, birch_log: 0.7, spruce_log: 0.7, planks: 0.5,
  oak_leaves: 0.12, birch_leaves: 0.12, spruce_leaves: 0.12, glass: 0.2, glowstone: 0.3, cactus: 0.25, lava: 0.2 };
const breakTime = (id) => (RENDER[id] === RENDER_CROSS ? 0 : (HARDNESS[BLOCKS[id] ? BLOCKS[id].name : ''] ?? 0.6));

/** Procedural 10-stage crack strip (160x16): random-walk cracks that grow with the stage. */
function makeCrackTexture() {
  const cv = document.createElement('canvas'); cv.width = 160; cv.height = 16;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(160, 16);
  let seed = 1337; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const order = [];
  for (let b = 0; b < 7; b++) {
    let x = 7 + rnd() * 2, y = 7 + rnd() * 2, a = rnd() * Math.PI * 2;
    for (let s = 0; s < 14; s++) { a += (rnd() - 0.5) * 1.3; x += Math.cos(a); y += Math.sin(a); if (x < 0 || y < 0 || x > 15 || y > 15) break; order.push([x | 0, y | 0]); }
  }
  for (let st = 0; st < 10; st++) {
    const n = Math.ceil(order.length * (st + 1) / 10);
    for (let i = 0; i < n; i++) {
      const [px, py] = order[i];
      const idx = (py * 160 + st * 16 + px) * 4;
      img.data[idx] = img.data[idx + 1] = img.data[idx + 2] = 0; img.data[idx + 3] = 210;
      if (st >= 5 && i % 3 === 0 && px < 15) { const k = idx + 4; img.data[k + 3] = 120; }
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false;
  tex.repeat.set(0.1, 1);
  return tex;
}

export class Interaction {
  /**
   * @param {{scene:THREE.Object3D, world:object, camera:THREE.Camera, player:object, getSelected:()=>number,
   *          onBreak?:(id:number)=>void, onPlace?:(id:number)=>void, onPick?:(id:number)=>void}} o
   */
  constructor(o) {
    Object.assign(this, { scene: o.scene, world: o.world, camera: o.camera, player: o.player, getSelected: o.getSelected, onBreak: o.onBreak, onPlace: o.onPlace, onPick: o.onPick });
    this.hit = null;
    this.progress = 0; this._tx = 0; this._ty = 0; this._tz = 0; this._tid = -1;
    this._cool = 0; this._placeCool = 0;
    this._origin = new THREE.Vector3(); this._dir = new THREE.Vector3();
    // outline
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.006, 1.006, 1.006));
    this.outline = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.7, depthTest: true, toneMapped: false }));
    this.outline.visible = false; this.outline.frustumCulled = false; this.outline.renderOrder = 3;
    // crack overlay
    this.crackTex = makeCrackTexture();
    this.crack = new THREE.Mesh(new THREE.BoxGeometry(1.008, 1.008, 1.008),
      new THREE.MeshBasicMaterial({ map: this.crackTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false }));
    this.crack.visible = false; this.crack.frustumCulled = false; this.crack.renderOrder = 4;
    this.scene.add(this.outline, this.crack);
    this.particles = new Particles(this.scene);
    this.enabled = true;
  }

  /** @param {number} dt  @param {{breakHeld:boolean, placeHeld:boolean, placePressed:boolean, pickPressed:boolean}} m  @param {number} pxPerUnit */
  update(dt, m, pxPerUnit) {
    this.particles.update(dt, pxPerUnit);
    if (!this.enabled) { this._clearTarget(); return; }
    const p = this.player;
    p.getLookDir(this._dir);
    this._origin.copy(this.camera.position);
    const hit = this.world.raycast(this._origin, this._dir, REACH);
    this.hit = hit;
    if (!hit) { this.outline.visible = false; this._resetBreak(); this._consume(m); return; }
    this.outline.visible = true; this.outline.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);

    this._cool -= dt; this._placeCool -= dt;
    // --- break
    if (m.breakHeld) {
      if (hit.x !== this._tx || hit.y !== this._ty || hit.z !== this._tz || hit.block !== this._tid) {
        this._tx = hit.x; this._ty = hit.y; this._tz = hit.z; this._tid = hit.block; this.progress = 0;
      }
      const bt = breakTime(hit.block);
      if (bt !== Infinity && this._cool <= 0) {
        this.progress += bt <= 0 ? 1 : dt / bt;
        if (this.progress >= 1) this._break(hit); else this._showCrack(hit);
      }
    } else this._resetBreak();
    // --- place
    if (m.placePressed || (m.placeHeld && this._placeCool <= 0)) { if (this._place(hit)) this._placeCool = 0.22; }
    // --- pick
    if (m.pickPressed && hit && this.onPick) this.onPick(hit.block);
    this._consume(m);
  }

  _consume(m) { m.placePressed = false; m.pickPressed = false; }

  _clearTarget() { this.outline.visible = false; this.crack.visible = false; this.hit = null; this.progress = 0; }

  _resetBreak() { this.progress = 0; this._tid = -1; this.crack.visible = false; }

  _showCrack(hit) {
    if (this.progress < 0.04) { this.crack.visible = false; return; }
    this.crack.visible = true;
    this.crack.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
    this.crackTex.offset.x = Math.min(9, Math.floor(this.progress * 10)) * 0.1;
  }

  _break(hit) {
    const w = this.world, id = hit.block;
    if (!w.setBlock(hit.x, hit.y, hit.z, B.AIR)) { this.progress = 0; return; }
    this.particles.burst(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5, blockColor(id), 20);
    // plants need support: pop the one above
    const above = w.getBlock(hit.x, hit.y + 1, hit.z);
    if (RENDER[above] === RENDER_CROSS) w.setBlock(hit.x, hit.y + 1, hit.z, B.AIR);
    if (this.onBreak) this.onBreak(id);
    this.progress = 0; this._tid = -1; this.crack.visible = false; this._cool = 0.2;
  }

  _place(hit) {
    const id = this.getSelected();
    if (!id) return false;
    let x = hit.x, y = hit.y, z = hit.z;
    if (RENDER[hit.block] !== RENDER_CROSS) { x += hit.nx; y += hit.ny; z += hit.nz; } // placing onto a plant replaces it
    if (y < 0 || y >= WORLD_HEIGHT) return false;
    const cur = this.world.getBlock(x, y, z);
    if (cur !== B.AIR && !LIQUID[cur] && RENDER[cur] !== RENDER_CROSS) return false;
    if (SOLID[id] && this.player.intersectsBlock(x, y, z)) return false;
    if (!this.world.setBlock(x, y, z, id)) return false;
    if (this.onPlace) this.onPlace(id);
    return true;
  }

  dispose() { this.outline.removeFromParent(); this.crack.removeFromParent(); this.particles.dispose(); this.crackTex.dispose(); }
}
