// Built-in items. Each handler receives the items runtime `S` (index.js), the item's private state `st` and the input edges `inp`.
// Hold-to-use items (bow, jetpack, grapple, gravity gun, shield) live in onHold; click items use use / useSecondary.
import { B, SOLID, LIQUID } from '../../shared/blocks.js';
import { K } from './entities.js';
import { MOB } from './combat.js';

const TAU = Math.PI * 2;
const FOOD = 4;

/** world position of the muzzle (a little right / below the eye), written into S.mz */
export function muzzle(S, fwd = 0.7, right = 0.26, down = 0.2) {
  const p = S.player, e = S.eye, d = S.dir, mz = S.mz, cy = Math.cos(p.yaw), sy = Math.sin(p.yaw);
  mz.x = e.x + d.x * fwd + cy * right; mz.y = e.y + d.y * fwd - down; mz.z = e.z + d.z * fwd - sy * right;
  return mz;
}
export const can = (S, id) => S.permissions.can('use-item', { item: id, by: S.localId });

/** @param {import('./index.js').Runtime} S */
export function builtinItems(S) {
  const sw = () => { if (S.hand) S.hand.swing(); };
  const defs = [];
  const add = (d) => defs.push(d);

  // ---------------------------------------------------------------- weapons
  add({ id: 'sword', name: 'Espada', category: 'weapon', cooldown: 0.42, desc: 'Golpe em arco: dano e empurrão.',
    use(S) { if (!can(S, 'sword')) return; sw(); S.audio.swing(true); if (S.combat.melee(6, 3.4, 8, 'espada')) S.hud.shake(0.012); } });

  add({ id: 'bow', name: 'Arco', category: 'weapon', desc: 'Segure o botão esquerdo para puxar; solte para atirar.',
    onHold(S, st, inp) {
      const ammo = S.inventory.creative || S.inventory.has('arrow');
      if (inp.pPressed && ammo && can(S, 'bow')) { st.charge = 0.001; S.audio.bowDraw(); }
      if (st.charge > 0) {
        if (inp.p) { st.charge = Math.min(1, st.charge + inp.dt / 0.9); S.hand.setItemAnim(st.charge, 0); }
        if (inp.pReleased || !inp.p) {
          const c = st.charge; st.charge = 0; S.hand.setItemAnim(0, 0);
          if (c > 0.15 && S.inventory.take('arrow')) {
            const m = muzzle(S, 0.8, 0.18, 0.12), d = S.dir;
            S.combat.projectile({ kind: 'arrow', x: m.x, y: m.y, z: m.z, dx: d.x, dy: d.y, dz: d.z, speed: 20 + 38 * c, damage: 2 + 7 * c, knockback: 2 + c * 3 });
            S.audio.bowShoot(c); sw(); S.hud.shake(0.004);
          }
        }
      }
    },
    onDeselect(S, st) { st.charge = 0; S.hand.setItemAnim(0, 0); } });

  add({ id: 'arrow', name: 'Flecha', category: 'weapon', stack: 64, cooldown: 0.4, desc: 'Munição do arco (necessária fora do modo criativo). Também pode ser arremessada.',
    use(S) { if (!can(S, 'arrow') || !S.inventory.take('arrow')) return; const m = muzzle(S), d = S.dir; sw(); S.audio.snowThrow(); S.combat.projectile({ kind: 'arrow', x: m.x, y: m.y, z: m.z, dx: d.x, dy: d.y, dz: d.z, speed: 16, damage: 2, knockback: 1 }); } });

  add({ id: 'tnt', name: 'TNT', category: 'special', stack: 16, cooldown: 0.5, desc: 'Esquerdo: arremessa TNT aceso (ou acende o bloco mirado). Direito: coloca o bloco.',
    use(S) {
      if (!can(S, 'tnt')) return;
      const h = S.hit;
      if (h && h.block === B.TNT && h.dist < 6) { S.combat.ignite(h.x, h.y, h.z, 2.4); sw(); return; }
      if (!S.inventory.take('tnt')) return;
      const m = muzzle(S, 0.9, 0.12, 0.1), d = S.dir;
      S.combat.prime(m.x, m.y, m.z, 3, d.x * 11, d.y * 11 + 2.5, d.z * 11, 'me'); sw(); S.audio.swing();
    },
    useSecondary(S) { const h = S.hit; if (h && S.inventory.has('tnt') && S.placeBlock(h, B.TNT)) S.inventory.take('tnt'); } });

  add({ id: 'lighter', name: 'Isqueiro', category: 'tool', cooldown: 0.3, desc: 'Acende blocos de TNT (qualquer botão).',
    use(S) { const h = S.hit; sw(); if (h && h.block === B.TNT && h.dist < 6) S.combat.ignite(h.x, h.y, h.z, 2.4); else S.audio.equip(); },
    useSecondary(S, st) { st.def.use(S, st); } });

  add({ id: 'snowball', name: 'Bola de neve', category: 'weapon', stack: 16, cooldown: 0.28, desc: 'Arremesse: empurra animais e jogadores.',
    use(S) {
      if (!can(S, 'snowball') || !S.inventory.take('snowball')) return;
      const m = muzzle(S, 0.7, 0.2, 0.15), d = S.dir; sw(); S.audio.snowThrow();
      S.combat.projectile({ kind: 'snowball', x: m.x, y: m.y, z: m.z, dx: d.x, dy: d.y + 0.05, dz: d.z, speed: 24, damage: 0, knockback: 7 });
    } });

  add({ id: 'shield', name: 'Escudo', category: 'weapon', desc: 'Segure o botão direito para reduzir 80% do dano recebido.',
    onHold(S, st, inp) { const g = inp.s; if (g !== st.on) { st.on = g; S.health.guard = g; if (g) S.audio.equip(); } },
    onDeselect(S, st) { st.on = false; S.health.guard = false; } });

  // ---------------------------------------------------------------- tools
  add({ id: 'gravity_gun', name: 'Arma de Gravidade', category: 'tool', cooldown: 0.2, outline: true,
    desc: 'Direito: pega/solta o bloco mirado · Esquerdo: arremessa (ou empurra) · Roda: aproxima/afasta.',
    onHold(S, st, inp) {
      const held = st.e;
      if (held) {
        if (!held.on) { st.e = null; return; }
        // follow the crosshair at distance st.dist, but never push the block into a wall
        const e = S.eye, d = S.dir, wall = S.world.raycast(e, d, st.dist + 0.7), dist = wall ? Math.max(1.6, Math.min(st.dist, wall.dist - 0.75)) : st.dist, k = Math.min(1, inp.dt * 14);
        held.x += (e.x + d.x * dist - held.x) * k; held.y += (e.y + d.y * dist - held.y) * k; held.z += (e.z + d.z * dist - held.z) * k;
        if (held.k !== K.PROP) held.spin += inp.dt * 1.2;
        if (inp.sPressed) this.release(S, st, false);
        else if (inp.pPressed) { this.release(S, st, true); }
      } else if (inp.sPressed && can(S, 'gravity_gun')) this.pick(S, st);
      else if (inp.pPressed && can(S, 'gravity_gun')) this.punt(S);
    },
    pick(S, st) {
      const e0 = S.eye, d0 = S.dir; let prop = null, pt = 11;      // props are picked before blocks
      for (const en of S.ents.list) {
        if (!en.on || en.k !== K.PROP || en.held) continue;
        const tx = en.x - e0.x, ty = en.y - e0.y, tz = en.z - e0.z, t = tx * d0.x + ty * d0.y + tz * d0.z;
        if (t < 0.3 || t > 10 || t > pt) continue;
        const px = tx - d0.x * t, py = ty - d0.y * t, pz = tz - d0.z * t;
        if (px * px + py * py + pz * pz < (en.r + 0.3) * (en.r + 0.3)) { prop = en; pt = t; }
      }
      if (prop) { prop.held = true; st.e = prop; st.dist = Math.max(2, Math.min(9, pt)); S.audio.gravPick(); sw(); return; }
      const h = S.world.raycast(S.eye, S.dir, 10); if (!h || h.block === B.BEDROCK || LIQUID[h.block]) { S.audio.equip(); return; }
      if (!S.permissions.can('break', { x: h.x, y: h.y, z: h.z, id: h.block, by: S.localId })) { S.toast('Você não pode pegar blocos aqui'); return; }
      if (!S.world.setBlock(h.x, h.y, h.z, B.AIR, 'local')) return;
      const e = S.ents.spawn(K.HELD, h.x + 0.5, h.y + 0.5, h.z + 0.5, 0, 0, 0, { block: h.block, life: 1e9 });
      if (!e) { S.world.setBlock(h.x, h.y, h.z, h.block, 'local'); return; }
      st.e = e; st.dist = Math.max(2.5, Math.min(9, h.dist)); S.audio.gravPick(); sw();
      S.particles().burst(h.x + 0.5, h.y + 0.5, h.z + 0.5, S.blockColor(h.block), 10, 0.9);
    },
    release(S, st, throwIt) {
      const e = st.e; st.e = null; if (!e || !e.on) return;
      const d = S.dir, id = e.block, x = e.x, y = e.y, z = e.z;
      if (e.k === K.PROP) { e.held = false; e.vx = throwIt ? d.x * 26 : 0; e.vy = throwIt ? d.y * 26 + 1.5 : 0; e.vz = throwIt ? d.z * 26 : 0; if (throwIt) { S.audio.gravThrow(); sw(); S.hud.shake(0.01); } else S.audio.gravDrop(); return; }
      S.ents.kill(e);
      const f = S.ents.spawn(K.FALL, x, y, z, throwIt ? d.x * 30 : 0, throwIt ? d.y * 30 + 1.5 : 0, throwIt ? d.z * 30 : 0, { block: id, r: 0.48, life: 20, owner: 'me' });
      if (!f) { S.world.applyEdit(Math.floor(x), Math.floor(y), Math.floor(z), id, 'local'); return; }
      if (throwIt) { S.audio.gravThrow(); sw(); S.hud.shake(0.012); } else S.audio.gravDrop();
    },
    punt(S) { // shove whatever is in the crosshair: mobs, primed TNT, loose blocks
      const e = S.eye, d = S.dir; let did = false;
      for (const en of S.ents.list) {
        if (!en.on || en.stuck || en.k === K.HELD || en.k === K.ARROW) continue;
        const tx = en.x - e.x, ty = en.y - e.y, tz = en.z - e.z, t = tx * d.x + ty * d.y + tz * d.z;
        if (t < 0.5 || t > 14) continue;
        const px = tx - d.x * t, py = ty - d.y * t, pz = tz - d.z * t;
        if (px * px + py * py + pz * pz < 0.8) { en.vx += d.x * 20; en.vy += d.y * 20 + 3; en.vz += d.z * 20; did = true; }
      }
      const t = S.combat.sweep(e.x, e.y, e.z, d.x, d.y, d.z, 14, 0.25, null);
      if (t && t.kind === 'mob') { S.combat.damageMob(t.ref, 1, d.x * 14, d.z * 14, 'me'); did = true; }
      else if (t && t.kind === 'player') { S.combat.hitPlayer(t.ref.id, 0, { knockback: { x: d.x * 14, y: 5, z: d.z * 14 }, weapon: 'arma de gravidade' }); did = true; }
      sw(); if (did) S.audio.gravThrow(); else S.audio.equip();
    },
    scroll(S, st, d) { if (st.e) st.dist = Math.max(1.8, Math.min(12, st.dist - d * 0.7)); return !!st.e; },
    onDeselect(S, st) { if (st.e) this.release(S, st, false); } });

  add({ id: 'jetpack', name: 'Jetpack', category: 'tool', outline: true, desc: 'Segure Espaço no ar. O combustível recarrega no chão.',
    onSelect(S, st) { if (st.fuel === undefined) st.fuel = 1; S.controls.noDoubleTapFly = true; },
    onHold(S, st, inp) {
      const p = S.player, dt = inp.dt, want = p.input.jump && !p.onGround && !p.inWater && st.fuel > 0 && S.health.alive;
      if (want) {
        if (p.flying) { p.flying = false; }
        p.accel.y = p.vy > 9 ? 0 : 30 + 28 * p.gravityScale;
        const fx = p.input.fwd || 0; if (fx) { p.accel.x += -Math.sin(p.yaw) * 9 * fx; p.accel.z += -Math.cos(p.yaw) * 9 * fx; }
        st.fuel = Math.max(0, st.fuel - dt / 6);
        st.t = (st.t || 0) - dt; if (st.t <= 0) { st.t = 0.045; S.particles().burst(p.x, p.y + 0.2, p.z, [1, 0.7, 0.25], 2, 0.5); }
        S.audio.jet(1); S.hand.setItemAnim(0, 1);
      } else {
        st.fuel = Math.min(1, st.fuel + dt * (p.onGround ? 0.45 : 0.04));
        S.audio.jet(0); S.hand.setItemAnim(0, 0);
      }
      S.hud.setFuel(st.fuel);
    },
    onDeselect(S, st) { S.audio.jet(0); S.hand.setItemAnim(0, 0); S.hud.setFuel(null); S.controls.noDoubleTapFly = false; } });

  add({ id: 'grapple', name: 'Gancho', category: 'tool', outline: true, desc: 'Esquerdo: lança o gancho e puxa você · solte para largar · Espaço também solta.',
    onHold(S, st, inp) {
      const p = S.player;
      if (inp.pPressed && !st.a && can(S, 'grapple')) {
        const o = S.eye, d = S.dir, h = S.world.raycast(o, d, 60);
        sw(); S.audio.grappleShoot();
        if (h) { st.a = { x: o.x + d.x * h.dist, y: o.y + d.y * h.dist, z: o.z + d.z * h.dist }; st.hitT = 0.08; p.flying = false; }
      }
      if (st.a) {
        if (st.hitT > 0) { st.hitT -= inp.dt; if (st.hitT <= 0) S.audio.grappleHit(); }
        const a = st.a, cx = p.x, cy = p.y + 1, cz = p.z, dx = a.x - cx, dy = a.y - cy, dz = a.z - cz, dist = Math.hypot(dx, dy, dz) || 1;
        if (!inp.p || dist < 2 || (p.input.jump && !st.jumpHeld)) { this.detach(S, st, p.input.jump); }
        else {
          const sp = 21, k = 7;
          p.accel.x = (dx / dist * sp - p.vx) * k; p.accel.y = (dy / dist * sp - p.vy) * k + 28 * p.gravityScale; p.accel.z = (dz / dist * sp - p.vz) * k;
          S.rope(muzzle(S, 0.8, 0.28, 0.25), a, true);
        }
      }
      st.jumpHeld = p.input.jump;
    },
    detach(S, st, hop) { st.a = null; S.rope(null, null, false); if (hop) S.player.impulse(0, 3, 0); },
    onDeselect(S, st) { this.detach(S, st, false); } });

  add({ id: 'prop_gun', name: 'Arma de Props', category: 'tool', cooldown: 0.22, desc: 'Esquerdo: dispara um prop físico (caixa, barril ou bola) · Direito: troca o prop · a Arma de Gravidade pega props.',
    use(S, st) {
      const kinds = ['crate', 'barrel', 'ball'], k = kinds[st.k || 0], m = muzzle(S, 0.9, 0.15, 0.1), d = S.dir;
      let n = 0, oldest = null; for (const e of S.ents.list) if (e.on && e.k === K.PROP) { n++; if (!oldest || e.age > oldest.age) oldest = e; }
      if (n >= 24 && oldest) S.ents.kill(oldest);
      const e = S.ents.spawn(K.PROP, m.x, m.y, m.z, d.x * 15, d.y * 15 + 1.5, d.z * 15, { data: k, r: k === 'ball' ? 0.32 : k === 'barrel' ? 0.38 : 0.42, life: 180 });
      if (!e) return;
      e.hitSet = Math.random() * 6; if (k === 'ball') { e.c[0] = 0.9 - Math.random() * 0.5; e.c[1] = 0.2 + Math.random() * 0.6; e.c[2] = 0.2 + Math.random() * 0.7; }
      sw(); S.audio.snowThrow();
    },
    useSecondary(S, st) { st.k = ((st.k || 0) + 1) % 3; S.toast('Prop: ' + ['Caixa', 'Barril', 'Bola'][st.k]); S.audio.equip(); } });

  add({ id: 'wand', name: 'Varinha Mágica', category: 'special', cooldown: 0.35, desc: 'Cria um animal aleatório onde você mira.',
    use(S) {
      if (!can(S, 'wand')) return;
      const mobs = S.ctx.mobs, h = S.hit; sw();
      if (!mobs || !mobs.list) { S.toast('Animais indisponíveis'); return; }
      if (mobs.max <= 0) { S.toast('Animais estão desligados nesta qualidade gráfica'); return; }
      if (mobs.list.length >= mobs.max + 3) { S.toast('Limite de animais atingido'); return; }
      const d = S.dir, e = S.eye, x = h ? h.x + 0.5 + h.nx : e.x + d.x * 4, y = h ? h.y + (h.ny > 0 ? 1 : h.ny < 0 ? -1.8 : 0) + 0.02 : e.y + d.y * 4 - 1, z = h ? h.z + 0.5 + h.nz : e.z + d.z * 4;
      const sp = (Math.random() * MOB.length) | 0, r = Math.random;
      mobs.list.push({ sp, x, y, z, vy: 0, yaw: r() * TAU, heading: r() * TAU, state: 0, timer: 1 + r() * 3, phase: r() * 6, anim: 0, graze: 0, grazeT: 0, rnd: r(), ground: true, voice: 4 + r() * 10, fleeT: 0 });
      S.audio.wand(); for (let i = 0; i < 3; i++) S.particles().burst(x, y + 0.6, z, [1, 0.9, 0.4 + 0.2 * i], 8, 1.1);
      S.hud.killFeed('Surgiu: ' + MOB[sp].name);
    } });

  add({ id: 'pickaxe', name: 'Picareta', category: 'tool', mining: (id) => (S.hardFor(id) === 'stone' ? 3.6 : 1.7), desc: 'Quebra pedra e minérios bem mais rápido.', use() { sw(); } });
  add({ id: 'axe', name: 'Machado', category: 'tool', mining: (id) => (S.hardFor(id) === 'wood' ? 3.6 : 1.7), desc: 'Corta madeira e folhas bem mais rápido.', use() { sw(); } });

  add({ id: 'fireworks', name: 'Foguete', category: 'special', stack: 16, cooldown: 0.5, desc: 'Sobe e explode em faíscas coloridas.',
    use(S) {
      if (!can(S, 'fireworks') || !S.inventory.take('fireworks')) return;
      const m = muzzle(S, 0.8, 0.2, 0.1), d = S.dir; sw(); S.audio.rocket();
      S.combat.projectile({ kind: 'rocket', x: m.x, y: m.y, z: m.z, dx: d.x * 0.3, dy: 1, dz: d.z * 0.3, speed: 8 });
    } });

  add({ id: 'pearl', name: 'Pérola de teletransporte', category: 'special', stack: 16, cooldown: 1, desc: 'Arremesse: você é levado até onde ela cair (custa 2 de vida).',
    use(S) {
      if (!can(S, 'pearl') || !S.inventory.take('pearl')) return;
      const m = muzzle(S, 0.7, 0.2, 0.15), d = S.dir; sw(); S.audio.snowThrow();
      S.combat.projectile({ kind: 'pearl', x: m.x, y: m.y, z: m.z, dx: d.x, dy: d.y + 0.04, dz: d.z, speed: 28 });
    } });

  add({ id: 'feather', name: 'Pena (queda lenta)', category: 'special', desc: 'Na mão: você flutua devagar e não sofre dano de queda.',
    onSelect(S) { S.player.fallCap = 3.4; }, onDeselect(S) { S.player.fallCap = 0; } });

  add({ id: 'boots', name: 'Botas de velocidade', category: 'special', desc: 'Na mão: você corre e pula mais rápido.',
    onSelect(S) { S.player.speedMul = 1.65; }, onDeselect(S) { S.player.speedMul = 1; } });

  add({ id: 'apple', name: 'Maçã', category: 'special', stack: 16, cooldown: 0.8, desc: 'Recupera 4 de vida.',
    use(S) { if (S.health.hp >= S.health.max || !S.inventory.take('apple')) { if (S.health.hp >= S.health.max) S.toast('Vida cheia'); return; } S.health.heal(FOOD); S.audio.pickup(); sw(); } });

  add({ id: 'build_wand', name: 'Varinha de Construção', category: 'tool', outline: true, cooldown: 0.25,
    desc: 'Esquerdo: marca dois cantos (preenche com o bloco do slot ao lado) · Direito: cancela.',
    use(S, st) {
      const h = S.hit; if (!h) return;
      if (!st.a) { st.a = [h.x, h.y, h.z]; S.toast('Canto 1 marcado — mire o canto 2'); S.audio.equip(); return; }
      const next = S.hotbar.slots[(S.hotbar.sel + 1) % 9], id = typeof next === 'number' && next > 0 ? next : B.STONE, a = st.a; st.a = null;
      const n = S.fillRegion(a[0], a[1], a[2], h.x, h.y, h.z, id);
      S.toast(n < 0 ? 'Região grande demais (máx. 4096 blocos)' : `Preenchendo ${n} blocos`);
    },
    useSecondary(S, st) { st.a = null; S.toast('Seleção cancelada'); } });

  add({ id: 'paint', name: 'Pincel', category: 'tool', outline: true, cooldown: 0.15, desc: 'Esquerdo: pinta o bloco mirado · Direito: troca a cor.',
    use(S, st) {
      const h = S.hit; if (!h || h.dist > 7) return; const c = S.PAINTS[st.c || 0];
      if (!S.permissions.can('place', { x: h.x, y: h.y, z: h.z, id: c, by: S.localId })) { S.toast('Você não pode pintar aqui'); return; }
      if (S.world.setBlock(h.x, h.y, h.z, c, 'local')) { S.audio.blockPlace(c); S.particles().burst(h.x + 0.5, h.y + 0.5, h.z + 0.5, S.blockColor(c), 6, 0.7); sw(); }
    },
    useSecondary(S, st) { st.c = ((st.c || 0) + 1) % S.PAINTS.length; S.toast('Cor: ' + S.blockLabel(S.PAINTS[st.c])); S.audio.equip(); } });

  return defs;
}
