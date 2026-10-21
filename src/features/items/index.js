// Items, health & combat feature (agent G). Publishes ctx.items, ctx.inventory, ctx.health, ctx.combat (CONTRACT2 §3 "G").
// Docs: docs/ITEMS.md. Per-frame cost when idle: a few comparisons (selection / inventory poll) — entities, combat queues and HUD return early.
import './items.css';
import * as THREE from 'three';
import { defineFeature } from '../registry.js';
import { B, SOLID, LIQUID, BLOCKS, RENDER, RENDER_CROSS } from '../../shared/blocks.js';
import { blockColor } from '../../game/blockColors.js';
import { blockLabel } from '../../ui/ui.js';
import { drawBlockIcon } from '../../ui/icons.js';
import { ItemRegistry } from './itemRegistry.js';
import { Inventory } from './inventory.js';
import { Entities, K } from './entities.js';
import { Combat } from './combat.js';
import { Health } from './health.js';
import { Hud } from './hud.js';
import { MODELS, drawModelIcon } from './models.js';
import { builtinItems } from './defs.js';
import { weaponItems } from './weapons.js';
import { Movement } from './movement.js';
import { installPalette } from './palette.js';

const STONE = /stone|cobble|brick|ore|bedrock|ice|terracotta|coral/, WOOD = /log|planks|leaves|cactus|hay/;
/** blocks the paint brush cycles through (coloured terracotta, corals, bricks, red sand) */
const PAINTS = [36, 37, 38, 39, 40, 44, 45, 46, 47, 35, 32];

/** Untrusted-ish model specs (registered by other features): keep only well-formed boxes, clamp numbers, cap the count. */
function safeModel(m) {
  if (!m || !Array.isArray(m.boxes)) return null;
  const n = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? Math.max(-64, Math.min(64, v)) : d), vec = (a, d) => (Array.isArray(a) ? [n(a[0], d[0]), n(a[1], d[1]), n(a[2], d[2])] : d);
  const boxes = [];
  for (const b of m.boxes.slice(0, 80)) {
    if (!Array.isArray(b) || b.length < 7 || !Array.isArray(b[6])) continue;
    boxes.push([n(b[0]), n(b[1]), n(b[2]), n(b[3]), n(b[4]), n(b[5]), [Math.max(0, Math.min(255, +b[6][0] || 0)), Math.max(0, Math.min(255, +b[6][1] || 0)), Math.max(0, Math.min(255, +b[6][2] || 0))], (b[7] | 0) > 4 ? 0 : (b[7] | 0)]);
  }
  if (!boxes.length) return null;
  return { boxes, scale: Math.max(0.002, Math.min(0.05, +m.scale || 0.015)), pos: vec(m.pos, [0.27, -0.3, -0.5]), rot: vec(m.rot, [-0.3, -0.3, 0.3]), swing: ['slash', 'thrust', 'throw', 'none'].includes(m.swing) ? m.swing : 'thrust', iconRot: m.iconRot };
}

/** The shared runtime handed to every item handler ("S"). */
class Runtime {
  constructor(ctx) {
    this.ctx = ctx; this.THREE = THREE; this.world = ctx.world; this.player = ctx.player; this.camera = ctx.camera; this.gr = ctx.gr; this.hand = ctx.gr.hand || { swing() {}, setItemAnim() {}, registerItem() {} };   // the mock renderer has no hand
    this.audio = ctx.audio; this.events = ctx.events; this.permissions = ctx.permissions; this.ui = ctx.ui; this.controls = ctx.controls; this.hotbar = ctx.hotbar; this.interaction = ctx.interaction;
    this.localId = ctx.identity.id;
    this.eye = new THREE.Vector3(); this.dir = new THREE.Vector3(); this.mz = { x: 0, y: 0, z: 0 };
    this.hit = null; this.dt = 0.016;
    this.PAINTS = PAINTS; this.blockColor = blockColor; this.blockLabel = blockLabel;
    this.inp = { dt: 0, p: false, s: false, pPressed: false, pReleased: false, sPressed: false, sReleased: false };
    this.prevP = false; this.prevS = false;
    this.cur = null; this.states = new Map(); this._deniedAt = 0; this._flyChk = 0; this._flyOk = true; this._flyInfo = { by: ctx.identity.id }; this._rope = null; this.eq = []; this.eqi = 0;

    this.items = new ItemRegistry();
    this.hud = new Hud({ ui: ctx.ui });
    this.inventory = new Inventory({ hotbar: ctx.hotbar, items: this.items, ui: ctx.ui, events: ctx.events });
    this.health = new Health(this);
    this.ents = new Entities({ gr: ctx.gr, world: ctx.world, ctx });
    this.combat = new Combat(this);
    this.movement = new Movement(this);
  }

  net() { return this.ctx.net || null; }
  particles() { return this.ctx.interaction.particles; }
  toast(m) { this.ui.toast(m); }
  hardFor(id) { const n = BLOCKS[id] ? BLOCKS[id].name : ''; return STONE.test(n) ? 'stone' : WOOD.test(n) ? 'wood' : ''; }

  drawItemIcon(canvas, id) {
    const def = this.items.get(id); canvas.width = canvas.height = 32;
    try {
      const ic = def && def.icon;
      if (typeof ic === 'function') { ic(canvas); return; }
      if (typeof ic === 'number') { drawBlockIcon(canvas, ic); return; }
      const key = typeof ic === 'string' && MODELS[ic] ? ic : def && MODELS[def.id] ? def.id : null;
      if (key && drawModelIcon(canvas, key)) return;
    } catch (e) { console.warn('[HZ] item icon failed:', id, e); }
    const g = canvas.getContext('2d'); g.fillStyle = '#5a6a8c'; g.fillRect(5, 5, 22, 22); g.fillStyle = '#fff'; g.font = 'bold 16px monospace'; g.textAlign = 'center'; g.fillText(String((def && def.name) || id).charAt(0).toUpperCase(), 16, 22);
  }

  // ---- selection ------------------------------------------------------------------------------------------------
  stateOf(def) { let st = this.states.get(def.id); if (!st) { st = { def, cd: 0 }; this.states.set(def.id, st); } return st; }

  syncSelection() {
    const v = this.hotbar.slots[this.hotbar.sel], def = typeof v === 'string' && this.ctx.state === 'playing' ? this.items.get(v) : null;
    if (def === this.cur) return;
    if (this.cur && this.cur.onDeselect) { try { this.cur.onDeselect(this, this.stateOf(this.cur)); } catch (e) { console.error('[HZ] item deselect failed:', this.cur.id, e); } }
    this.cur = def; this.interaction.breakMul = 1;
    this.prevP = this.ctx.controls.mouse.breakHeld; this.prevS = this.ctx.controls.mouse.placeHeld;
    if (def) {
      this.audio.equip();
      if (def.onSelect) { try { def.onSelect(this, this.stateOf(def)); } catch (e) { console.error('[HZ] item select failed:', def.id, e); } }
    }
  }

  /** called by Interaction every frame while gameplay is active: returns the interaction mode (0 blocks · 1 item · 2 tool · 3 outline only) */
  frame(dt, m, hit) {
    this.dt = dt; this.hit = hit; this.eye.copy(this.camera.position); this.player.getLookDir(this.dir);
    this.syncSelection();
    const def = this.cur; if (!def) return 0;
    const st = this.stateOf(def), inp = this.inp, p = !!m.breakHeld, s = !!m.placeHeld;
    inp.dt = dt; inp.p = p; inp.s = s; inp.pPressed = p && !this.prevP; inp.pReleased = !p && this.prevP; inp.sPressed = !!m.placePressed || (s && !this.prevS); inp.sReleased = !s && this.prevS;
    this.prevP = p; this.prevS = s;
    if (!this.health.alive) return 1;
    st.cd -= dt;
    try {
      if (def.onHold) def.onHold(this, st, inp);
      if (st.cd <= 0) {
        if (inp.pPressed && def.use) { if (this._allowed(def)) { def.use(this, st, inp); st.cd = def.cooldown; this.events.emit('item:use', { id: def.id, secondary: false }); } }
        else if (inp.sPressed && def.useSecondary) { if (this._allowed(def)) { def.useSecondary(this, st, inp); st.cd = def.cooldown; this.events.emit('item:use', { id: def.id, secondary: true }); } }
      }
    } catch (e) { console.error('[HZ] item failed:', def.id, e); }
    if (def.mining) this.interaction.breakMul = typeof def.mining === 'function' ? def.mining(hit ? hit.block : 0) : def.mining;
    return def.mining ? 2 : def.outline ? 3 : 1;
  }

  _allowed(def) {
    if (this.permissions.can('use-item', { item: def.id, by: this.localId })) return true;
    const now = performance.now(); if (now - this._deniedAt > 1500) { this._deniedAt = now; this.toast('Este item está desativado aqui'); }
    return false;
  }

  // ---- helpers used by item handlers ------------------------------------------------------------------------------
  /** place block `id` against the targeted face (same rules as Interaction) */
  placeBlock(hit, id) {
    const x = hit.x + hit.nx, y = hit.y + hit.ny, z = hit.z + hit.nz, w = this.world;
    if (y < 0 || y >= 192) return false;
    const cur = w.getBlock(x, y, z);
    if (cur !== B.AIR && !LIQUID[cur] && RENDER[cur] !== RENDER_CROSS) return false;
    if (SOLID[id] && this.player.intersectsBlock(x, y, z)) return false;
    if (!this.permissions.can('place', { x, y, z, id, by: this.localId })) { this.toast('Você não pode construir aqui'); return false; }
    if (!w.setBlock(x, y, z, id, 'local')) return false;
    this.audio.blockPlace(id); if (this.hand) this.hand.swing();
    return true;
  }

  /** queue a cuboid fill (processed a few hundred blocks per frame). Returns the block count, or -1 when too big. */
  fillRegion(x0, y0, z0, x1, y1, z1, id) {
    const ax = Math.min(x0, x1), bx = Math.max(x0, x1), ay = Math.max(0, Math.min(y0, y1)), by = Math.min(191, Math.max(y0, y1)), az = Math.min(z0, z1), bz = Math.max(z0, z1);
    const n = (bx - ax + 1) * (by - ay + 1) * (bz - az + 1);
    if (n > 4096) return -1;
    if (!this.permissions.can('place', { x: ax, y: ay, z: az, id, by: this.localId })) { this.toast('Você não pode construir aqui'); return 0; }
    for (let y = ay; y <= by; y++) for (let z = az; z <= bz; z++) for (let x = ax; x <= bx; x++) this.eq.push(x, y, z, id);
    return n;
  }

  /** grappling-hook rope between two points (null to hide) */
  rope(a, b, on) {
    let m = this._rope;
    if (!on) { if (m) m.visible = false; return; }
    if (!m) { m = this._rope = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0x7a5a36, toneMapped: false })); m.frustumCulled = false; this.gr.scene.add(m); }
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    m.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2); m.scale.set(0.05, 0.05, Math.hypot(dx, dy, dz) || 0.01); m.lookAt(b.x, b.y, b.z); m.visible = true;
  }

  /** put the gun's block / bow charge / jetpack down: used when the game stops being "playing" */
  suspend() {
    if (!this.cur) return;
    const def = this.cur; this.cur = null;
    if (def.onDeselect) { try { def.onDeselect(this, this.stateOf(def)); } catch (e) { console.error(e); } }
  }

  update(dt) {
    const ctx = this.ctx;
    this.dt = dt;
    if (ctx.state !== 'playing' || !this.health.alive) this.suspend(); else if (typeof this.hotbar.slots[this.hotbar.sel] === 'string' || this.cur) this.syncSelection();
    this.inventory.poll();
    this.health.update(dt);
    const now = performance.now();
    if (now - this._flyChk > 250) { // permissions 'fly' (dome rules / minigames) -> Player.flyMode, only touched when the answer changes
      this._flyChk = now; const ok = this.permissions.can('fly', this._flyInfo);
      if (ok !== this._flyOk) { this._flyOk = ok; this.player.flyMode = ok ? 'normal' : 'off'; if (!ok) this.toast('Voo desativado aqui'); }
    }
    if (this.player.flyMode === 'off' && this.player.flying) { this.player.flying = false; this.ui.setFly(false); }
    this.eye.copy(this.camera.position);
    this.movement.update(dt);
    this.ents.update(dt, this.camera.position);
    this.combat.update(dt);
    if (this.eqi < this.eq.length) this._pumpEdits();
    this.hud.update(dt, this.camera);
    if (this._boundNet !== ctx.net) { this._boundNet = ctx.net; if (this._unbind) this._unbind(); this._unbind = this.combat.bindNet(); }
  }

  _pumpEdits() {
    const q = this.eq, w = this.world; let n = 500;
    while (this.eqi < q.length && n-- > 0) {
      const x = q[this.eqi], y = q[this.eqi + 1], z = q[this.eqi + 2], id = q[this.eqi + 3]; this.eqi += 4;
      if (w.getBlock(x, y, z) === id) continue;
      if (!w.setBlock(x, y, z, id, 'local')) w.applyEdit(x, y, z, id, 'local');
    }
    if (this.eqi >= q.length) { q.length = 0; this.eqi = 0; }
  }

  dispose() {
    this.suspend(); this.ents.dispose(); this.hud.dispose(); if (this.dashBtn) this.dashBtn.remove();
    if (this._unbind) this._unbind();
    if (this._rope) { this._rope.removeFromParent(); this._rope.geometry.dispose(); this._rope.material.dispose(); }
  }
}

let S = null;

export default defineFeature({
  id: 'items', order: 10,

  init(ctx) {
    S = new Runtime(ctx);
    const { items, inventory, health, combat, ents } = S;

    // ---- registry -> hand models; built-in items ------------------------------------------------------------------
    let refreshQueued = false;
    items.onRegister = (d) => {
      const m = d.model ? safeModel(d.model) : MODELS[d.id];
      if (m) S.hand.registerItem(d.id, m);
      if (!refreshQueued) { refreshQueued = true; queueMicrotask(() => { refreshQueued = false; S.ui.refreshIcons(); }); }   // icons for items registered later (minigames)
    };
    for (const d of builtinItems(S)) items.register(d);
    for (const d of weaponItems(S)) items.register(d);
    S.ui.itemRenderer = { icon: (canvas, id) => S.drawItemIcon(canvas, id), label: (id) => { const d = items.get(id); return d ? d.name : ''; } };

    // ---- public API (CONTRACT2 §3 G) ---------------------------------------------------------------------------------
    // items registered by other features follow the contract shape use(ctx, hand, S?, st?, inp?) — adapt them to the runtime's (S, st, inp)
    const adapt = (def) => {
      if (!def || typeof def !== 'object') return def;
      const d = Object.assign({}, def);
      for (const k of ['use', 'useSecondary', 'onHold', 'onSelect', 'onDeselect']) if (typeof def[k] === 'function') d[k] = (R, st, inp) => def[k].call(def, ctx, R.hand, R, st, inp);
      return d;
    };
    ctx.items = { get: (id) => items.get(id), all: () => items.all(), register: (def) => items.register(adapt(def)), byCategory: (c) => items.byCategory(c), drawIcon: (canvas, id) => S.drawItemIcon(canvas, id) };
    ctx.inventory = inventory; ctx.health = health; ctx.combat = combat;
    ctx.itemsRuntime = S;          // internal (tests / other features that need entities): not part of the contract

    // ---- wiring into the engine -----------------------------------------------------------------------------------
    ctx.interaction.itemHook = (dt, m, hit) => S.frame(dt, m, hit);
    ctx.interaction.permit = (action, info) => { info.by = S.localId; return ctx.permissions.can(action, info); };
    ctx.interaction.onDenied = (action) => { const now = performance.now(); if (now - S._deniedAt > 1500) { S._deniedAt = now; S.toast(action === 'break' ? 'Você não pode quebrar blocos aqui' : 'Você não pode construir aqui'); } };
    ents.onProjectile = (e, ax, ay, az, bx, by, bz, t) => combat.onProjectile(e, ax, ay, az, bx, by, bz, t);
    ents.onBody = (e) => combat.onBody(e);
    ents.onFuse = (e) => { if (!e.vis) combat.explode(e.x, e.y, e.z, e.k === K.GRENADE ? 3.2 : 4, { by: e.owner }); };
    ents.onMine = (e) => combat.mineTick(e, S.dt);
    ents.onFallLand = (e, cx, cy, cz) => {
      for (let y = cy, i = 0; i < 4; i++, y++) {
        const cur = S.world.getBlock(cx, y, cz);
        if (cur === B.AIR || LIQUID[cur] || RENDER[cur] === RENDER_CROSS) {
          if (!ctx.permissions.can('place', { x: cx, y, z: cz, id: e.block, by: S.localId })) return;
          if (!S.world.setBlock(cx, y, cz, e.block, 'local')) S.world.applyEdit(cx, y, cz, e.block, 'local');
          S.audio.blockPlace(e.block); S.particles().burst(cx + 0.5, y + 0.5, cz + 0.5, blockColor(e.block), 6, 0.8); return;
        }
      }
    };
    ents.onBlockImpact = (e, hit) => {
      if (e.k === K.ARROW) {
        S.audio.arrowHit(hit.block);
        if (hit.block === B.TNT && !e.vis) combat.ignite(hit.x, hit.y, hit.z, 1.6);
      } else if (e.k === K.SNOW) { S.audio.snowHit(); S.particles().burst(e.x, e.y, e.z, [0.95, 0.97, 1], 8, 0.8); }
      else if (e.k === K.PEARL && !e.vis) {
        let y = e.y; const x = e.x, z = e.z;
        for (let i = 0; i < 4 && (SOLID[S.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z))] || SOLID[S.world.getBlock(Math.floor(x), Math.floor(y + 1), Math.floor(z))]); i++) y += 1;
        S.particles().burst(S.player.x, S.player.y + 1, S.player.z, [0.4, 0.9, 0.85], 14, 1.2);
        S.player.teleport(x, Math.floor(y) + 0.02, z); S.audio.teleport(); S.particles().burst(x, y + 1, z, [0.4, 0.9, 0.85], 14, 1.2);
        health.damage(2, 'generic');
      } else if (e.k === K.MISSILE) { if (!e.vis) combat.explode(e.x, e.y, e.z, 3.4, { by: S.localId }); }
      else if (e.k === K.ROCKET) ents.onExpire(e);
    };
    ents.onExpire = (e) => {
      if (e.k === K.MISSILE) { if (!e.vis) combat.explode(e.x, e.y, e.z, 3.4, { by: S.localId }); return; }
      if (e.k !== K.ROCKET) return;
      const cols = [[1, 0.3, 0.3], [0.3, 0.8, 1], [1, 0.9, 0.3], [0.5, 1, 0.5], [1, 0.5, 1]], pc = S.particles(), d = Math.hypot(e.x - ctx.camera.position.x, e.y - ctx.camera.position.y, e.z - ctx.camera.position.z);
      for (let i = 0; i < 4; i++) pc.burst(e.x, e.y, e.z, cols[(Math.random() * cols.length) | 0], 24, 3.2);
      S.audio.explosion(1.6, d * 1.5); ents.kill(e);
    };
    ents.onPickup = (e) => {
      const p = S.player, dx = p.x - e.x, dy = p.y + 0.8 - e.y, dz = p.z - e.z, d = Math.hypot(dx, dy, dz);
      if (d > 1.4 && d < 4) { e.vx = dx / d * 6; e.vz = dz / d * 6; if (dy > 0) e.vy = Math.max(e.vy, 3); }
      if (d > 1.4 || !S.health.alive) return false;
      if (e.data === 'meat') { if (S.health.hp >= S.health.max) return false; S.health.heal(3); S.toast('Carne: +3 de vida'); }
      S.audio.pickup(); return true;
    };

    // scroll wheel pushes / pulls the gravity gun's block instead of switching slots
    const act = ctx.controls.actions, orig = act.hotbarDelta;
    act.hotbarDelta = (d) => { const c = S.cur; if (c && c.scroll && c.scroll(S, S.stateOf(c), d)) return; if (orig) orig(d); };

    // fall damage must forget the old height when something teleports us
    const tp = ctx.player.teleport.bind(ctx.player);
    ctx.player.teleport = (x, y, z) => { tp(x, y, z); health._falling = false; health._peak = y; };

    ctx.addHotkey('KeyV', () => S.movement.dash());
    S.dashBtn = ctx.ui.addToolbarButton({ id: 'dash', icon: '⚡', title: 'Dash', key: 'V', onClick: () => S.movement.dash() });
    ctx.movement = S.movement;
    S.offPalette = installPalette(S);
    ctx.events.on('inventory:change', (p) => {
      const v = p.item; ctx.localState.item = typeof v === 'string' ? v : v ? 'block:' + v : null;
      const slots = ctx.ui.hotbarSlots;   // stack counts on the hotbar (only outside creative mode)
      for (let i = 0; i < 9; i++) { const n = !inventory.creative && p.slots[i] !== null && inventory.counts[i] > 1 ? String(inventory.counts[i]) : ''; if (n) slots[i].dataset.count = n; else delete slots[i].dataset.count; }
    });
  },

  ready(ctx) {
    if (!S) return;
    const p = ctx.player;
    S.health.home = { x: p.x, y: p.y, z: p.z };
    S.inventory.sanitize();
    S._boundNet = ctx.net; S._unbind = S.combat.bindNet();
    ctx.localState.hp = S.health.hp;
    let seen = false; try { seen = localStorage.getItem('horizon.items.hint') === '1'; localStorage.setItem('horizon.items.hint', '1'); } catch { /* storage unavailable */ }
    if (!seen) setTimeout(() => ctx.ui.toast('Dica: E abre o inventário — espada, arco, TNT, jetpack e mais'), 2500);
  },

  update(dt) { if (S) S.update(dt); },

  dispose() { if (S) { if (S.offPalette) S.offPalette(); S.dispose(); S = null; } },
});
