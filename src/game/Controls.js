// Controls: keyboard + pointer-lock mouse + touch (virtual joystick / look drag / buttons) -> player.input and gameplay actions.
const KEY_FWD = ['KeyW', 'ArrowUp'], KEY_BACK = ['KeyS', 'ArrowDown'], KEY_LEFT = ['KeyA', 'ArrowLeft'], KEY_RIGHT = ['KeyD', 'ArrowRight'];

export class Controls {
  /**
   * @param {{canvas:HTMLCanvasElement, player:object, touch:boolean}} o
   * Gameplay callbacks to assign on `actions`: hotbar(i), hotbarDelta(d), palette(), debug(), screenshot(), cycleTime(), mute(), pause(), flyToggled(bool)
   */
  constructor({ canvas, player, touch }) {
    this.canvas = canvas; this.player = player; this.touch = !!touch;
    this.active = false;          // gameplay input enabled (state === playing)
    this.sens = 1;
    this.keys = Object.create(null);
    /** Mouse/touch button state consumed by Interaction. */
    this.mouse = { breakHeld: false, placeHeld: false, placePressed: false, pickPressed: false };
    this.actions = {};
    /** features register hotkeys here: KeyboardEvent.code -> fn(event); only fire while gameplay input is active */
    this.extraKeys = new Map();
    this._lastSpace = 0; this.noDoubleTapFly = false;   // items (jetpack) turn the double-tap-to-fly shortcut off
    this.dragMode = false; this._drag = null; this._lockAct = false; this.onDragMode = null;
    this._tj = { id: -1, cx: 0, cy: 0, fwd: 0, strafe: 0, sprint: false };
    this._tl = { id: -1, x: 0, y: 0 };
    this._tbtn = { jump: false, down: false };
    this._bind();
  }

  /** True when the mouse is captured, or when drag-look fallback is active (pointer lock unavailable, e.g. sandboxed iframe). */
  get locked() { return this.dragMode || document.pointerLockElement === this.canvas; }

  lock() {
    // Failures only count as "pointer lock unavailable" when the request had a user gesture behind it.
    // Escape never counts as a user gesture for pointer lock (Chrome refuses): don't ask, and don't mistake the refusal for "lock unavailable" (that
    // used to flip the game into drag-look mode with a permanent cursor). The next click recaptures the mouse (see main.js pointerdown handler).
    if (performance.now() - (window.__hzEscAt || 0) < 400) { this._lockAct = false; if (this.onNeedClick) this.onNeedClick(); return; }
    const t = window.event && window.event.type, mouse = t === 'pointerdown' || t === 'mousedown' || t === 'mouseup' || t === 'click' || t === 'pointerup';
    const act = (navigator.userActivation ? navigator.userActivation.isActive : true) && mouse;   // only a real mouse click can prove "lock is unavailable here"
    this._lockAct = act;
    const fail = () => { if (act) this.enterDragMode(); };
    try { const p = this.canvas.requestPointerLock(); if (p && p.catch) p.catch(fail); } catch { fail(); }
  }
  /** Fallback input: left-drag looks around, hold still to break, quick tap (or right click) to place. */
  enterDragMode() { if (this.dragMode) return; this.dragMode = true; if (this.onDragMode) this.onDragMode(); }
  unlock() { try { if (this.locked) document.exitPointerLock(); } catch { /* ignore */ } }

  /** Release all held inputs (focus loss, pause). */
  reset() {
    this.keys = Object.create(null);
    const m = this.mouse; m.breakHeld = m.placeHeld = m.placePressed = m.pickPressed = false;
    this._tj.id = -1; this._tj.fwd = this._tj.strafe = 0; this._tj.sprint = false; this._tl.id = -1;
    this._tbtn.jump = this._tbtn.down = false;
    const knob = document.getElementById('joy-knob'); if (knob) knob.style.transform = '';
    const inp = this.player.input; inp.fwd = inp.strafe = 0; inp.jump = inp.sprint = inp.crouch = false;
  }

  /** Per-frame: fold keyboard + touch state into player.input. */
  update() {
    const inp = this.player.input, k = this.keys, tj = this._tj;
    if (!this.active) { inp.fwd = inp.strafe = 0; inp.jump = inp.sprint = inp.crouch = false; return; }
    const dg = this._drag; if (dg && !dg.moved && !this.mouse.breakHeld && performance.now() - dg.t > 220) this.mouse.breakHeld = true; // hold still = break
    const any = (a) => (k[a[0]] || k[a[1]]) ? 1 : 0;
    inp.fwd = Math.max(-1, Math.min(1, any(KEY_FWD) - any(KEY_BACK) + tj.fwd));
    inp.strafe = Math.max(-1, Math.min(1, any(KEY_RIGHT) - any(KEY_LEFT) + tj.strafe));
    inp.jump = !!k.Space || this._tbtn.jump;
    inp.sprint = !!(k.ShiftLeft || k.ShiftRight) || tj.sprint;
    inp.crouch = !!(k.ControlLeft || k.KeyC) || this._tbtn.down;
  }

  _bind() {
    const doc = document, cv = this.canvas;
    doc.addEventListener('keydown', (e) => this._key(e, true));
    doc.addEventListener('keyup', (e) => this._key(e, false));
    window.addEventListener('blur', () => this.reset());
    doc.addEventListener('visibilitychange', () => { if (doc.hidden) this.reset(); });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('mousedown', (e) => {
      if (!this.active) return;
      if (!this.locked && !this.touch) { this.lock(); return; }
      if (this.dragMode && e.button === 0) { this._drag = { t: performance.now(), dist: 0, moved: false }; e.preventDefault(); return; }
      this._button(e.button, true); e.preventDefault();
    });
    window.addEventListener('mouseup', (e) => {
      const dg = this._drag;
      if (this.dragMode && e.button === 0 && dg) {
        if (!dg.moved && performance.now() - dg.t < 220 && this.active) { this.mouse.placePressed = true; }
        this._drag = null; this.mouse.breakHeld = false; return;
      }
      this._button(e.button, false);
    });
    doc.addEventListener('mousemove', (e) => {
      if (!this.active || !this.locked) return;
      if (this.dragMode && !this._drag) return;
      const dx = e.movementX || 0, dy = e.movementY || 0;
      if (Math.abs(dx) > 400 || Math.abs(dy) > 400) return; // Chromium pointer-lock spikes
      if (this._drag) { this._drag.dist += Math.abs(dx) + Math.abs(dy); if (this._drag.dist > 6) { this._drag.moved = true; this.mouse.breakHeld = false; } }
      const k = 0.0022 * this.sens;
      this.player.look(-dx * k, -dy * k);
    });
    window.addEventListener('wheel', (e) => {
      if (!this.active) return;
      const d = e.deltaY || e.deltaX;
      if (e.shiftKey || e.ctrlKey) {
        const p = this.player;
        p.flySpeed = Math.max(3, Math.min(200, p.flySpeed * (d < 0 ? 1.2 : 1 / 1.2)));
        if (this.actions.flySpeed) this.actions.flySpeed(p.flySpeed);
      } else if (d && this.actions.hotbarDelta) this.actions.hotbarDelta(d > 0 ? 1 : -1);
      e.preventDefault();
    }, { passive: false });
    if (this.touch) this._bindTouch();
  }

  _button(b, down) {
    const m = this.mouse;
    if (b === 0) m.breakHeld = down;
    else if (b === 2) { m.placeHeld = down; if (down) m.placePressed = true; }
    else if (b === 1 && down) m.pickPressed = true;
  }

  _key(e, down) {
    const c = e.code;
    if (!this.active) { if (!down) this.keys[c] = false; return; }
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    if (c === 'F3' || c === 'F2' || c === 'Tab' || c === 'Space' || (e.ctrlKey && c.startsWith('Key')) || c.startsWith('Arrow')) e.preventDefault();
    if (down && !e.repeat) {
      const a = this.actions;
      if (c === 'Space') {
        const now = performance.now();
        if (now - this._lastSpace < 300 && !(this.player.extraJumps > 0) && !this.noDoubleTapFly) { this._toggleFly(); this._lastSpace = 0; } else this._lastSpace = now;
      } else if (c === 'KeyF') this._toggleFly();
      else if (c === 'KeyE' && a.palette) a.palette();
      else if (c === 'F3' && a.debug) a.debug();
      else if (c === 'F2' && a.screenshot) a.screenshot();
      else if (c === 'KeyT' && a.cycleTime) a.cycleTime();
      else if (c === 'KeyM' && a.mute) a.mute();
      else if (c === 'KeyL' && a.lantern) a.lantern();
      else if (c === 'KeyK' && a.weather) a.weather();
      else if (this.extraKeys.has(c)) { e.preventDefault(); this.extraKeys.get(c)(e); }
      else if (c === 'KeyP' && a.photo) a.photo();
      else if ((c === 'BracketLeft' || c === 'BracketRight') && a.aperture) a.aperture(c === 'BracketRight' ? 1 : -1);
      else if (c === 'Escape' && a.pause) a.pause();
      else if (c.startsWith('Digit') && c.length === 6 && a.hotbar) { const n = +c[5]; if (n >= 1 && n <= 9) a.hotbar(n - 1); }
    }
    this.keys[c] = down;
  }

  _toggleFly() {
    const p = this.player;
    if (p.flyMode === 'off' && !p.flying) return;     // fly disabled by the game mode / dome rules
    p.flying = !p.flying;
    if (p.flying) p.vy = 0;
    if (this.actions.flyToggled) this.actions.flyToggled(p.flying);
  }

  // ---- touch -------------------------------------------------------------------------------------------------
  _bindTouch() {
    const joy = document.getElementById('joy'), knob = document.getElementById('joy-knob');
    const tj = this._tj, tl = this._tl;
    const R = 56;
    const moveJoy = (t) => {
      let dx = t.clientX - tj.cx, dy = t.clientY - tj.cy;
      const l = Math.hypot(dx, dy) || 1, c = Math.min(1, l / R);
      dx = dx / l * c; dy = dy / l * c;
      tj.strafe = dx; tj.fwd = -dy; tj.sprint = c > 0.97;
      knob.style.transform = `translate(${dx * R * 0.7}px, ${dy * R * 0.7}px)`;
    };
    window.addEventListener('touchstart', (e) => {
      if (!this.active) return;
      for (const t of e.changedTouches) {
        const el = t.target;
        if (el === joy || el === knob) {
          const r = joy.getBoundingClientRect(); tj.id = t.identifier; tj.cx = r.left + r.width / 2; tj.cy = r.top + r.height / 2; moveJoy(t);
        } else if (el.dataset && el.dataset.act) this._touchBtn(el, true);
        else if (el === this.canvas && tl.id < 0) { tl.id = t.identifier; tl.x = t.clientX; tl.y = t.clientY; }
      }
      if (e.target === this.canvas) e.preventDefault();
    }, { passive: false });
    window.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === tj.id) moveJoy(t);
        else if (t.identifier === tl.id) {
          const k = 0.0042 * this.sens;
          this.player.look(-(t.clientX - tl.x) * k, -(t.clientY - tl.y) * k);
          tl.x = t.clientX; tl.y = t.clientY;
        }
      }
      if (this.active) e.preventDefault();
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === tj.id) { tj.id = -1; tj.fwd = tj.strafe = 0; tj.sprint = false; knob.style.transform = ''; }
        else if (t.identifier === tl.id) tl.id = -1;
        const el = t.target;
        if (el && el.dataset && el.dataset.act) this._touchBtn(el, false);
      }
    };
    window.addEventListener('touchend', end);
    window.addEventListener('touchcancel', end);
  }

  _touchBtn(el, down) {
    const act = el.dataset.act, m = this.mouse;
    el.classList.toggle('on', down);
    if (act === 'jump') {
      this._tbtn.jump = down;
      if (down) { const now = performance.now(); if (now - this._lastSpace < 300) { this._toggleFly(); this._lastSpace = 0; } else this._lastSpace = now; }
    } else if (act === 'down') this._tbtn.down = down;
    else if (act === 'break') m.breakHeld = down;
    else if (act === 'place') { m.placeHeld = down; if (down) m.placePressed = true; }
    else if (down && act === 'fly') this._toggleFly();
    else if (down && act === 'menu' && this.actions.pause) this.actions.pause();
    else if (down && act === 'palette' && this.actions.palette) this.actions.palette();
  }
}
