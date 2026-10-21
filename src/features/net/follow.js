// Spectate / follow: a third-person camera glued to a remote player. Movement keys, Space, Enter or Esc end it.
export function createFollow(ctx, net) {
  let id = null, snap = true;
  const cam = ctx.camera, tmp = new ctx.THREE.Vector3(), END = /^(Escape|Space|KeyW|KeyA|KeyS|KeyD|Enter|ArrowUp|ArrowDown|ArrowLeft|ArrowRight)$/;
  const onKey = (e) => { if (END.test(e.code)) { e.preventDefault(); e.stopPropagation(); f.stop(); } };
  const f = {
    get active() { return id !== null; },
    /** Start following player `pid` (closes panels first so the game input is back before we take the camera). */
    start(pid) {
      const rp = net.players.get(pid); if (!rp || !rp.hasPos) { ctx.ui.toast('Esse jogador ainda não está visível'); return; }
      ctx.ui.closePanels(); id = pid; snap = true;
      ctx.controls.reset(); ctx.controls.active = false;
      if (ctx.gr.hand) ctx.gr.hand.root.visible = false;
      document.addEventListener('keydown', onKey, true);
      ctx.ui.toast('Seguindo ' + rp.name + ' · Esc ou uma tecla de movimento para sair');
    },
    stop() {
      if (id === null) return; id = null;
      document.removeEventListener('keydown', onKey, true);
      if (ctx.gr.hand) ctx.gr.hand.root.visible = true;
      ctx.controls.active = ctx.state === 'playing';
    },
    /** call every frame after the player's own camera update */
    update(dt) {
      if (id === null) return;
      const rp = net.players.get(id);
      if (!rp || !rp.hasPos) { f.stop(); return; }
      const fx = -Math.sin(rp.yaw), fz = -Math.cos(rp.yaw);
      tmp.set(rp.pos.x - fx * 4.4, rp.pos.y + 2.7, rp.pos.z - fz * 4.4);
      if (snap) { cam.position.copy(tmp); snap = false; } else cam.position.lerp(tmp, Math.min(1, dt * 7));
      cam.lookAt(rp.pos.x, rp.pos.y + 1.4, rp.pos.z);
    },
  };
  return f;
}
