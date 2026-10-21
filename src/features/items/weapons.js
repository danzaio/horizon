// PvP arsenal + movement gadgets (rifle, shotgun, rocket launcher, railgun, grenade, mine, demolition hammer, harpoon, glider) and their ammo.
// Same handler shape as defs.js: (S, st, inp). All damage goes through ctx.combat (hitscan / projectile / explode) so permissions and the
// network model (victim-resolved hits, authority-resolved block destruction) apply unchanged.
import { B } from '../../shared/blocks.js';
import { muzzle, can } from './defs.js';

const TAU = Math.PI * 2;
const ammo = (S, id) => S.inventory.creative || S.inventory.has(id);
const spend = (S, id) => S.inventory.take(id);
const kick = (S, up, side = 0) => { const p = S.player; p.pitch = Math.min(1.5, p.pitch + up); p.yaw += side; };

/** @param {import('./index.js').Runtime} S */
export function weaponItems(S) {
  const sw = () => { if (S.hand) S.hand.swing(); };
  const defs = []; const add = (d) => defs.push(d);

  // ------------------------------------------------------------------ ammo
  add({ id: 'bullet', name: 'Balas', category: 'weapon', stack: 120, desc: 'Munição do Fuzil (fora do modo criativo).', use() {} });
  add({ id: 'shell', name: 'Cartuchos', category: 'weapon', stack: 48, desc: 'Munição da Escopeta (fora do modo criativo).', use() {} });
  add({ id: 'missile_ammo', name: 'Mísseis', category: 'weapon', stack: 16, desc: 'Munição do Lança-mísseis (fora do modo criativo).', use() {} });
  add({ id: 'cell', name: 'Células de energia', category: 'weapon', stack: 12, desc: 'Munição da Railgun (fora do modo criativo).', use() {} });

  // ------------------------------------------------------------------ rifle: hold to spray, right = scope
  add({ id: 'rifle', name: 'Fuzil', category: 'weapon', desc: 'Segure o botão esquerdo para atirar (dano ×2 na cabeça) · Direito: mira (zoom).',
    onHold(S, st, inp) {
      st.t = (st.t || 0) - inp.dt; st.heat = Math.max(0, (st.heat || 0) - inp.dt * 2.2);
      const want = inp.s; if (want !== st.zoom) { st.zoom = want; S.player.fovMul = want ? 0.5 : 1; }
      if (inp.p && st.t <= 0 && S.health.alive) {
        if (!can(S, 'rifle')) return;
        if (!ammo(S, 'bullet')) { S.toast('Sem balas'); st.t = 0.4; return; }
        spend(S, 'bullet'); st.t = 0.105; st.heat = Math.min(1, st.heat + 0.09);
        const m = muzzle(S, 0.9, 0.2, 0.16);
        S.combat.hitscan({ range: 90, dmg: 3.2, head: 2, spread: (want ? 0.004 : 0.012) + st.heat * (want ? 0.01 : 0.045), falloff: 60, kb: 1.5, color: [1, 0.85, 0.4], thick: 0.025, weapon: 'fuzil', from: m });
        S.audio.gun('rifle'); sw(); S.hud.shake(0.004); kick(S, 0.006 + st.heat * 0.012, (Math.random() - 0.5) * 0.004);
      }
    },
    onDeselect(S, st) { S.player.fovMul = 1; st.zoom = false; } });

  // ------------------------------------------------------------------ shotgun
  add({ id: 'shotgun', name: 'Escopeta', category: 'weapon', cooldown: 0.85, desc: 'Oito projéteis em leque: devastadora de perto. Empurra você para trás.',
    use(S) {
      if (!can(S, 'shotgun')) return;
      if (!ammo(S, 'shell')) { S.toast('Sem cartuchos'); return; }
      spend(S, 'shell'); const m = muzzle(S, 0.9, 0.2, 0.16), d = S.dir;
      S.combat.hitscan({ range: 36, dmg: 2.6, head: 1.4, pellets: 8, spread: 0.075, falloff: 16, kb: 3.2, color: [1, 0.7, 0.3], thick: 0.018, weapon: 'escopeta', from: m });
      S.player.impulse(-d.x * 3.2, -d.y * 1.5, -d.z * 3.2);
      S.audio.gun('shotgun'); sw(); S.hud.shake(0.018); kick(S, 0.05); S.particles().burst(m.x, m.y, m.z, [1, 0.8, 0.3], 8, 1.2);
    } });

  // ------------------------------------------------------------------ missile launcher (rocket-jump friendly)
  add({ id: 'rocket_launcher', name: 'Lança-mísseis', category: 'weapon', cooldown: 1.1, desc: 'Míssil explosivo: destrói blocos e arremessa quem estiver perto — mire no chão para dar um rocket-jump.',
    use(S) {
      if (!can(S, 'rocket_launcher') || !S.permissions.can('explode', { by: S.localId })) { S.toast('Explosões desativadas aqui'); return; }
      if (!ammo(S, 'missile_ammo')) { S.toast('Sem mísseis'); return; }
      spend(S, 'missile_ammo'); const m = muzzle(S, 1.0, 0.2, 0.14), d = S.dir;
      S.combat.projectile({ kind: 'missile', x: m.x, y: m.y, z: m.z, dx: d.x, dy: d.y, dz: d.z, speed: 30, damage: 0 });
      S.audio.gun('rocket'); sw(); S.hud.shake(0.02); kick(S, 0.03); S.particles().burst(m.x, m.y, m.z, [1, 0.8, 0.4], 10, 1.4);
    } });

  // ------------------------------------------------------------------ railgun: pierces players and terrain
  add({ id: 'railgun', name: 'Railgun', category: 'weapon', cooldown: 1.6, desc: 'Raio perfurante: atravessa jogadores e até 6 blocos de terreno. Recarga lenta.',
    use(S) {
      if (!can(S, 'railgun')) return;
      if (!ammo(S, 'cell')) { S.toast('Sem células'); return; }
      spend(S, 'cell'); const m = muzzle(S, 0.9, 0.2, 0.16);
      S.combat.hitscan({ range: 120, dmg: 13, head: 1.5, pierce: true, carve: 6, kb: 9, color: [0.4, 0.9, 1], thick: 0.09, weapon: 'railgun', from: m });
      S.audio.gun('rail'); sw(); S.hud.shake(0.03); kick(S, 0.04); S.player.impulse(-S.dir.x * 2, 0, -S.dir.z * 2);
    } });

  // ------------------------------------------------------------------ grenade / mine
  add({ id: 'grenade', name: 'Granada', category: 'weapon', stack: 8, cooldown: 0.9, desc: 'Esquerdo: arremessa (explode em 2,3 s, quica) · Direito: lança curto.',
    use(S) { this._throw(S, 17, 3); },
    useSecondary(S) { this._throw(S, 8, 1.5); },
    _throw(S, sp, up) {
      if (!can(S, 'grenade') || !S.permissions.can('explode', { by: S.localId })) { S.toast('Explosões desativadas aqui'); return; }
      if (!S.inventory.take('grenade')) return;
      const m = muzzle(S, 0.8, 0.15, 0.1), d = S.dir; sw(); S.audio.swing();
      S.combat.grenade(m.x, m.y, m.z, d.x * sp + S.player.vx * 0.5, d.y * sp + up + S.player.vy * 0.2, d.z * sp + S.player.vz * 0.5);
    } });

  add({ id: 'mine', name: 'Mina de proximidade', category: 'weapon', stack: 6, cooldown: 0.6, desc: 'Coloque no chão: arma em 1,2 s e explode quando alguém chega perto. Cuidado, a sua também te pega.',
    use(S) {
      const h = S.hit; if (!h || h.dist > 5.5 || h.ny !== 1) { S.toast('Mire no chão'); return; }
      if (!can(S, 'mine') || !S.permissions.can('explode', { by: S.localId })) { S.toast('Explosões desativadas aqui'); return; }
      if (!S.inventory.take('mine')) return;
      S.combat.placeMine(h.x + 0.5, h.y + 1, h.z + 0.5); sw(); S.audio.blockPlace(B.STONE); S.audio.beep(true);
    } });

  // ------------------------------------------------------------------ demolition hammer
  add({ id: 'hammer', name: 'Marreta de Demolição', category: 'weapon', cooldown: 0.7, outline: true,
    desc: 'Golpe pesado: dano e grande empurrão; em blocos abre uma cratera. Direito: pancada no chão (impulso para cima).',
    use(S) {
      if (!can(S, 'hammer')) return; sw(); S.audio.swing(true);
      const hit = S.combat.melee(9, 3.3, 14, 'marreta'); if (hit) S.hud.shake(0.02);
      const h = S.hit;
      if (h && h.dist < 5 && S.permissions.can('explode', { by: S.localId })) {
        const x = h.x + 0.5 + h.nx * 0.4, y = h.y + 0.5 + h.ny * 0.4, z = h.z + 0.5 + h.nz * 0.4;
        S.combat.explode(x, y, z, 2.2, { by: S.localId, noSelf: true }); S.hud.shake(0.03);
      }
    },
    useSecondary(S) {
      const p = S.player; if (!p.onGround) return; sw(); S.audio.slam(); S.hud.shake(0.03);
      p.impulse(0, 11, 0); S.health.noFall = Math.max(S.health.noFall, 0.8);
      S.combat.explode(p.x, p.y + 0.2, p.z, 1.6, { by: S.localId, noSelf: true });
    } });

  // ------------------------------------------------------------------ harpoon: yank people (or yourself)
  add({ id: 'harpoon', name: 'Arpão', category: 'weapon', cooldown: 1.4, desc: 'Fisga alvos: puxa jogadores e animais até você · em blocos, puxa você até lá.',
    use(S) {
      if (!can(S, 'harpoon')) return; const e = S.eye, d = S.dir, m = muzzle(S, 0.9, 0.22, 0.2); sw(); S.audio.grappleShoot();
      const wb = S.world.raycast(e, d, 38), reach = wb ? wb.dist : 38;
      const t = S.combat.sweep(e.x, e.y, e.z, d.x, d.y, d.z, reach, 0.2, null);
      if (t) {
        const tx = e.x + d.x * t.t, ty = e.y + d.y * t.t, tz = e.z + d.z * t.t;
        S.combat.beam(m.x, m.y, m.z, tx, ty, tz, [0.9, 0.75, 0.4], 0.05, true);
        const dx = e.x - (t.kind === 'player' ? t.ref.pos.x : t.ref.x), dz = e.z - (t.kind === 'player' ? t.ref.pos.z : t.ref.z), l = Math.hypot(dx, dz) || 1;
        if (t.kind === 'player') S.combat.hitPlayer(t.ref.id, 2, { knockback: { x: dx / l * 17, y: 6, z: dz / l * 17 }, weapon: 'arpão' });
        else S.combat.damageMob(t.ref, 2, dx / l * 14, dz / l * 14, 'me');
        S.audio.grappleHit();
      } else if (wb) {
        const tx = e.x + d.x * reach, ty = e.y + d.y * reach, tz = e.z + d.z * reach, p = S.player, dx = tx - p.x, dy = ty - (p.y + 1), dz = tz - p.z, l = Math.hypot(dx, dy, dz) || 1;
        S.combat.beam(m.x, m.y, m.z, tx, ty, tz, [0.9, 0.75, 0.4], 0.05, true);
        p.impulse(dx / l * 18, dy / l * 18 + 3, dz / l * 18); p.flying = false; S.health.noFall = Math.max(S.health.noFall, 0.6); S.audio.grappleHit();
      } else S.combat.beam(m.x, m.y, m.z, e.x + d.x * 38, e.y + d.y * 38, e.z + d.z * 38, [0.9, 0.75, 0.4], 0.03, true);
    } });

  // ------------------------------------------------------------------ glider: hold Space in the air
  add({ id: 'glider', name: 'Planador', category: 'tool', outline: true, desc: 'Segure Espaço no ar: plana para frente (e perde menos altura). Combine com dash e gancho.',
    onHold(S, st, inp) {
      const p = S.player;
      if (!p.onGround && !p.flying && !p.inWater && p.input.jump && p.vy < 0.5 && S.health.alive) {
        p.vy = Math.max(p.vy, -2.6);
        const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw), hs = Math.hypot(p.vx, p.vz);
        if (hs < 17) { p.accel.x += -sy * 14; p.accel.z += -cy * 14; }
        S.health._peak = p.y; st.on = true; S.audio.jet(0.35);
      } else if (st.on) { st.on = false; S.audio.jet(0); }
    },
    onDeselect(S, st) { if (st.on) { st.on = false; S.audio.jet(0); } } });

  void TAU;
  return defs;
}
