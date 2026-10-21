// Editor: a right-hand dock (a see-through modal panel, so the world stays visible) + in-world editing. All entity visuals are drawn by ONE EntityView
// (instanced boxes + merged outlines) and exist only while editor mode is on. The rule builder is generated from the schema descriptor tables.
import { ENTITY_TYPES, ENTITY_ORDER, EVENTS, CONDITIONS, ACTIONS, MODES, WIN_TYPES, LIMITS, emptyGameDef, nextEntityId, defaultProps, cleanParam, lintGameDef, materialId, TEAM_COLORS } from './schema.js';
import { EntityView, lowEnd } from './view3d.js';
import { GameRuntime } from './runtime.js';
import { exportCode, importAny } from './codec.js';
import { saveGame } from './store.js';
import { h, paramField, selectOf } from './dom.js';

const NO_ACTOR = new Set(['gameStart', 'tick', 'timer']);
const TABS = [['obj', '🧱 Objetos'], ['rules', '⚙️ Regras'], ['game', '🎮 Jogo'], ['file', '💾 Arquivo']];

export class Editor {
  /** @param {object} ctx @param {import('./session.js').Session} session @param {{browse:()=>void, placeHere:(def:object,lift?:number)=>void}} api */
  constructor(ctx, session, api) {
    this.ctx = ctx; this.session = session; this.api = api; this.view = new EntityView(ctx);
    this.on = false; this.panel = null; this.def = null; this.sel = ''; this.tab = 'obj'; this.hist = []; this.fut = []; this._last = ''; this.savedId = ''; this.hover = ''; this._hoverAt = 0;
    this.builder = null; this.msg = ''; this.side = 'right'; this._v = new ctx.THREE.Vector3(); this._d = new ctx.THREE.Vector3(); this.hint = null; this.bar = null; this._click = null;
    this._items = h('datalist', { id: 'mg-items' });
  }

  // ------------------------------------------------------------------ open / close
  /** Enter editor mode with `def` (a validated GameDef; a fresh game when omitted) and open the dock. */
  open(def, savedId = '') {
    if (this.session.active) this.session.stop();
    if (def || !this.def) { this.def = def ? structuredClone(def) : emptyGameDef(); this.savedId = savedId; this.sel = ''; this.hist = []; this.fut = []; this._last = JSON.stringify(this.def); }
    this.on = true; this._ensureBar(); this._refreshView(); this.openPanel();
  }
  openPanel() {
    if (this.panel) return;
    if (this.ctx.items) { this._items.replaceChildren(...this.ctx.items.all().map((d) => h('option', { value: d.id }, d.name || d.id))); }
    this.root = h('div', { class: 'mg-ed' });
    this.panel = this.ctx.ui.panel({ id: 'mg-editor', title: '🎮 Editor', content: this.root, width: 372, onClose: () => { this.panel = null; this._unclick(); } });
    if (!this.panel) return;                       // same id toggles closed
    this.panel.el.classList.add('mg-dock'); if (this.side === 'left') this.panel.el.classList.add('left');
    this._click = (e) => this._onCanvasClick(e); this.ctx.gr.renderer.domElement.addEventListener('mousedown', this._click);
    this._render();
  }
  _unclick() { if (this._click) { this.ctx.gr.renderer.domElement.removeEventListener('mousedown', this._click); this._click = null; } }
  togglePanel() { if (this.panel) this.panel.close(); else this.openPanel(); }
  /** Leave editor mode entirely. */
  close() {
    this.on = false; if (this.panel) this.panel.close(); this.view.hide(); this._unclick();
    if (this.bar) { this.bar.remove(); this.bar = null; } if (this.hint) { this.hint.remove(); this.hint = null; }
    for (const c of ['KeyQ', 'Delete', 'Numpad4', 'Numpad6', 'Numpad8', 'Numpad2', 'Numpad9', 'Numpad7']) this.ctx.removeHotkey(c);
  }
  _ensureBar() {
    if (!this.bar) { this.bar = h('div', { class: 'mg-edbar' }, 'Editor: Y painel · Q seleciona sob a mira · Numpad 4/6/8/2/9/7 move (Shift = tamanho) · Del exclui'); this.ctx.ui.hudLayer.appendChild(this.bar); }
    if (!this.hint) { this.hint = h('div', { class: 'mg-cursor-hint hidden' }); this.ctx.ui.hudLayer.appendChild(this.hint); }
    const K = this.ctx, mv = (k, d) => (e) => { if (this.selected && !this.session.active) this.nudge(e.shiftKey && 'xyz'.includes(k) ? { x: 'w', y: 'h', z: 'd' }[k] : k, d); };
    K.addHotkey('KeyQ', () => { const id = this.hover || this._pickAim(); if (id) { this.select(id); if (!this.panel) this.openPanel(); } });
    // numpad: 4/6 = X−/+, 8/2 = Z−/+, 9/7 = Y+/−; with Shift the same keys resize (largura/profundidade/altura)
    for (const [code, k, d] of [['Numpad4', 'x', -1], ['Numpad6', 'x', 1], ['Numpad8', 'z', -1], ['Numpad2', 'z', 1], ['Numpad9', 'y', 1], ['Numpad7', 'y', -1]]) K.addHotkey(code, mv(k, d));
    K.addHotkey('Delete', () => { if (this.selected && !this.session.active) this.del(); });
  }

  // ------------------------------------------------------------------ view / selection
  _refreshView() { if (this.on && !this.session.active) this.view.show('editor', this.def, { sel: this.sel, hover: this.hover, labels: !lowEnd(this.ctx), teamColor: (id) => { const t = this.def.meta.teams.find((x) => x.id === id); return t && t.color; } }); }
  select(id) { this.sel = id; this.tab = 'obj'; this._refreshView(); if (this.panel) this._render(); }
  _pickAim() { const o = this.ctx.camera.position; this.ctx.player.getLookDir(this._d); return this.view.pick(o.x, o.y, o.z, this._d.x, this._d.y, this._d.z, 90); }
  _onCanvasClick(e) {
    if (e.button !== 0 || !this.on || this.session.active) return;
    const cam = this.ctx.camera, r = e.target.getBoundingClientRect(), v = this._v.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1, 0.5).unproject(cam);
    v.sub(cam.position).normalize(); const id = this.view.pick(cam.position.x, cam.position.y, cam.position.z, v.x, v.y, v.z, 160);
    if (id) this.select(id); else if (this.sel) { this.sel = ''; this._refreshView(); this._render(); }
  }
  get selected() { return this.def && this.def.entities.find((e) => e.id === this.sel) || null; }

  /** per-frame while editor mode is on (cheap: hover test ~10 Hz, block builder pump) */
  update(dt) {
    if (this.builder) { this.builder.pumpBlocks(); if (!this.builder.building) { this.builder = null; this.ctx.ui.toast('Arena construída'); } }
    if (!this.on || this.session.active) { if (this.hint) this.hint.classList.add('hidden'); return; }
    this.view.update(dt);
    const now = performance.now(); if (this.panel || now - this._hoverAt < 100) return; this._hoverAt = now;
    const id = this._pickAim();
    if (id !== this.hover) {
      this.hover = id; this._refreshView();
      const e = id && this.def.entities.find((x) => x.id === id);
      if (e) { this.hint.textContent = `Q: selecionar ${ENTITY_TYPES[e.type].icon} ${e.name || ENTITY_TYPES[e.type].label}`; this.hint.classList.remove('hidden'); } else this.hint.classList.add('hidden');
    }
  }

  // ------------------------------------------------------------------ history
  commit() {
    const snap = JSON.stringify(this.def); if (snap === this._last) return;
    this.hist.push(this._last); if (this.hist.length > 80) this.hist.shift(); this.fut.length = 0; this._last = snap; this._refreshView();
  }
  undo() { if (!this.hist.length) return; this.fut.push(this._last); this._last = this.hist.pop(); this.def = JSON.parse(this._last); if (!this.selected) this.sel = ''; this._refreshView(); this._render(); }
  redo() { if (!this.fut.length) return; this.hist.push(this._last); this._last = this.fut.pop(); this.def = JSON.parse(this._last); this._refreshView(); this._render(); }

  // ------------------------------------------------------------------ entity ops
  _aim() {
    const w = this.ctx.world, o = this.ctx.camera.position; this.ctx.player.getLookDir(this._d);
    const hit = w.raycast(o, this._d, 90);
    if (hit) return { x: hit.x + hit.nx, y: hit.y + hit.ny, z: hit.z + hit.nz };
    return { x: Math.floor(o.x + this._d.x * 8), y: Math.floor(o.y + this._d.y * 8), z: Math.floor(o.z + this._d.z * 8) };
  }
  addEntity(type) {
    const def = this.def; if (def.entities.length >= LIMITS.entities) { this.ctx.ui.toast('Limite de objetos atingido'); return; }
    const T = ENTITY_TYPES[type], at = this._aim(), [w, hh, d] = T.size;
    if (!def.entities.length && !def.arena.length) { def.anchor = { x: at.x, y: Math.max(1, Math.min(180, at.y)), z: at.z }; }
    const a = def.anchor;
    const e = { id: nextEntityId(def), type, x: at.x - a.x - (w > 2 ? Math.floor(w / 2) : 0), y: at.y - a.y, z: at.z - a.z - (d > 2 ? Math.floor(d / 2) : 0), w, h: hh, d, name: '', p: defaultProps(type, def) };
    def.entities.push(e); this.sel = e.id; this.commit(); this._render();
  }
  dup() { const e = this.selected; if (!e || this.def.entities.length >= LIMITS.entities) return; const c = structuredClone(e); c.id = nextEntityId(this.def); c.x += e.w + 1; if (c.type === 'checkpoint') c.p.order = this.def.entities.filter((x) => x.type === 'checkpoint').length + 1; this.def.entities.push(c); this.sel = c.id; this.commit(); this._render(); }
  del() {
    const e = this.selected; if (!e) return;
    this.def.entities = this.def.entities.filter((x) => x.id !== e.id);
    for (const x of this.def.entities) for (const s of ENTITY_TYPES[x.type].props) if (s.kind === 'entity' && x.p[s.key] === e.id) x.p[s.key] = '';
    const clr = (o, specs) => { for (const s of specs) if (s.kind === 'entity' && o[s.key] === e.id) o[s.key] = ''; };
    for (const r of this.def.rules) { clr(r.when, EVENTS[r.when.ev].params); r.if.forEach((c) => clr(c, CONDITIONS[c.c].params)); r.then.forEach((a) => clr(a, ACTIONS[a.a].params)); }
    this.sel = ''; this.commit(); this._render();
  }
  nudge(key, delta) {
    const e = this.selected; if (!e) return; const min = { w: 1, h: 1, d: 1 }[key] ?? -LIMITS.coord, max = { w: LIMITS.size, h: LIMITS.size, d: LIMITS.size }[key] ?? LIMITS.coord;
    e[key] = Math.max(min, Math.min(max, e[key] + delta)); this.commit(); this._render();
  }
  gotoSel() { const e = this.selected; if (!e) return; const a = this.def.anchor; this.ctx.player.teleport(a.x + e.x + e.w / 2, a.y + e.y + e.h + 4, a.z + e.z + e.d / 2 - 6); this.ctx.player.flying = true; this.ctx.ui.setFly(true); this.ctx.ui.toast('Câmera movida até o objeto'); }

  _canBuild() { if (this.session.isAuthority) return true; this.ctx.ui.toast('Só o anfitrião pode construir blocos do jogo'); return false; }
  fillSel() {
    if (!this._canBuild()) return;
    const e = this.selected; if (!e || !(e.type === 'area' || e.type === 'door')) return;
    const b = this._builder(); const a = this.def.anchor, x0 = a.x + e.x, y0 = a.y + e.y, z0 = a.z + e.z;
    b.queueFill(x0, y0, z0, x0 + e.w - 1, y0 + e.h - 1, z0 + e.d - 1, materialId(e.p.material));
  }
  _builder() {
    if (!this.builder) this.builder = new GameRuntime(this.def, { fx() {}, listPlayers: () => [], getBlock: () => 0, setBlock: (x, y, z, id) => this.ctx.world.applyEdit(x, y, z, id, 'game') }, { blocksPerTick: lowEnd(this.ctx) ? 600 : 1500 });
    return this.builder;
  }
  /** Moves the whole game next to the player and builds its arena. */
  buildHere(lift = 0) { if (!this._canBuild()) return; this.api.placeHere(this.def, lift); this.commit(); const b = this._builder(); b.queueRebuild(); this._refreshView(); this._render(); }

  // ------------------------------------------------------------------ rendering
  _render() {
    if (!this.root || !this.panel) return;
    const sc = this.panel.el.querySelector('.panel'), keep = sc.scrollTop, root = this.root; root.replaceChildren();
    const top = h('div', { class: 'mg-tabs' });
    for (const [id, label] of TABS) top.appendChild(h('button', { class: this.tab === id ? 'on' : '', onclick: () => { this.tab = id; this._render(); } }, label));
    top.appendChild(h('button', { title: 'Desfazer', onclick: () => this.undo() }, '↶')); top.appendChild(h('button', { title: 'Refazer', onclick: () => this.redo() }, '↷'));
    top.appendChild(h('button', { title: 'Mover o painel para o outro lado', onclick: () => { this.side = this.side === 'right' ? 'left' : 'right'; this.panel.el.classList.toggle('left', this.side === 'left'); } }, '⇄'));
    root.appendChild(top);
    if (this.msg) root.appendChild(h('div', { class: 'mg-hint' }, this.msg));
    root.append(this._items, this[{ obj: '_tabObjects', rules: '_tabRules', game: '_tabGame', file: '_tabFile' }[this.tab]]());
    sc.scrollTop = keep;
  }

  _tabObjects() {
    const def = this.def, box = h('div', { class: 'mg-ed' });
    const add = h('div', { class: 'mg-sec' }, h('h3', null, 'Adicionar na mira'));
    const grid = h('div', { class: 'mg-grid' });
    for (const t of ENTITY_ORDER) { const T = ENTITY_TYPES[t]; const b = h('button', { class: 'mg-add', title: T.help, onclick: () => this.addEntity(t) }, h('span', null, T.icon), T.label); b.style.setProperty('--c', T.color); grid.appendChild(b); }
    add.appendChild(grid); add.appendChild(h('div', { class: 'mg-hint' }, 'Aponte a mira para o chão, clique no botão e o objeto aparece ali. Clique num objeto no mundo (ou Q) para selecionar.')); box.appendChild(add);
    const list = h('div', { class: 'mg-sec' }, h('h3', null, `Objetos (${def.entities.length}/${LIMITS.entities})`)); const ul = h('div', { class: 'mg-list' });
    for (const e of def.entities) { const T = ENTITY_TYPES[e.type]; const it = h('div', { class: 'mg-item' + (e.id === this.sel ? ' on' : ''), onclick: () => this.select(e.id) }, h('span', null, T.icon), e.name || T.label, h('small', null, e.id)); it.style.setProperty('--c', T.color); ul.appendChild(it); }
    list.appendChild(ul); box.appendChild(list);
    const e = this.selected; if (e) box.appendChild(this._props(e));
    const warn = lintGameDef(def); if (warn.length) box.appendChild(h('div', { class: 'mg-warn' }, warn.map((w) => '⚠ ' + w).join('\n')));
    return box;
  }

  _props(e) {
    const T = ENTITY_TYPES[e.type], sec = h('div', { class: 'mg-sec' }, h('h3', null, `${T.icon} ${T.label} · ${e.id}`));
    const ctxD = { teams: new Set(this.def.meta.teams.map((t) => t.id)), ids: new Set(this.def.entities.map((x) => x.id)) };
    const f = h('div', { class: 'mg-f' });
    f.append(h('label', null, 'Nome'), h('input', { type: 'text', maxlength: 24, value: e.name, onchange: (ev) => { e.name = ev.target.value.slice(0, 24); this.commit(); this._render(); } }));
    for (const k of ['x', 'y', 'z', 'w', 'h', 'd']) f.append(h('label', null, { x: 'X (relativo)', y: 'Y (relativo)', z: 'Z (relativo)', w: 'Largura', h: 'Altura', d: 'Profundidade' }[k]), h('input', { type: 'number', step: 1, value: e[k], onchange: (ev) => { const v = Math.round(+ev.target.value); e[k] = Number.isFinite(v) ? v : e[k]; if ('whd'.includes(k)) e[k] = Math.max(1, Math.min(LIMITS.size, e[k])); this.commit(); this._render(); } }));
    for (const s of T.props) f.append(h('label', null, s.label), paramField(this.ctx, this.def, s, e.p[s.key], (v) => { e.p[s.key] = cleanParam(s, v, ctxD); this.commit(); this._render(); }, { entTypes: s.types }));
    sec.appendChild(f);
    const mk = (title, keys) => { const row = h('div', { class: 'mg-nudge' }); for (const [k, d, label] of keys) row.appendChild(h('button', { title: `${title} (Shift = 5)`, onclick: (ev) => this.nudge(k, d * (ev.shiftKey ? 5 : 1)) }, label)); return row; };
    sec.append(h('div', { class: 'mg-hint' }, 'Mover (Shift = 5 blocos)'), mk('Mover', [['x', -1, 'X−'], ['x', 1, 'X+'], ['y', -1, 'Y−'], ['y', 1, 'Y+'], ['z', -1, 'Z−'], ['z', 1, 'Z+']]),
      h('div', { class: 'mg-hint' }, 'Tamanho'), mk('Tamanho', [['w', -1, 'L−'], ['w', 1, 'L+'], ['h', -1, 'A−'], ['h', 1, 'A+'], ['d', -1, 'P−'], ['d', 1, 'P+']]));
    const row = h('div', { class: 'btn-row' });
    row.append(h('button', { class: 'btn', onclick: () => this.dup() }, 'Duplicar'), h('button', { class: 'btn', onclick: () => this.gotoSel() }, 'Ir até'));
    if (e.type === 'area' || e.type === 'door') row.append(h('button', { class: 'btn', onclick: () => this.fillSel() }, 'Preencher agora'));
    row.append(h('button', { class: 'btn danger', onclick: () => this.del() }, 'Excluir')); sec.appendChild(row);
    return sec;
  }

  // ---- rules
  _defaults(specs, base) { for (const s of specs) base[s.key] = s.kind === 'bool' ? !!s.def : s.def; return base; }
  _tabRules() {
    const def = this.def, box = h('div', { class: 'mg-ed' });
    box.appendChild(h('div', { class: 'mg-hint' }, 'Regras: QUANDO algo acontece, SE as condições forem verdadeiras, ENTÃO faça as ações. Os objetos já têm comportamento próprio (chegada, checkpoint, zona mortal…); use regras para o resto.'));
    def.rules.forEach((r, i) => box.appendChild(this._ruleCard(r, i)));
    box.appendChild(h('button', { class: 'btn primary', onclick: () => { if (def.rules.length >= LIMITS.rules) return; def.rules.push({ id: 'r' + Date.now().toString(36).slice(-5), name: '', when: this._defaults(EVENTS.gameStart.params, { ev: 'gameStart' }), if: [], then: [this._defaults(ACTIONS.message.params, { a: 'message' })], once: false }); this.commit(); this._render(); } }, '＋ Nova regra'));
    return box;
  }

  _ruleCard(r, i) {
    const ctxD = { teams: new Set(this.def.meta.teams.map((t) => t.id)), ids: new Set(this.def.entities.map((x) => x.id)) };
    const set = (spec, obj) => (v) => { obj[spec.key] = cleanParam(spec, v, ctxD); this.commit(); };
    const card = h('div', { class: 'mg-rule' });
    const fields = (specs, obj, skipWho) => specs.filter((s) => !(skipWho && s.key === 'who')).map((s) => [h('span', { class: 'mg-hint' }, s.label), paramField(this.ctx, this.def, s, obj[s.key], set(s, obj), { entTypes: s.types, none: obj === r.when ? '(qualquer)' : '(nenhum)' })]).flat();
    const typed = (table, cur, onPick) => selectOf(Object.keys(table).map((k) => [k, table[k].label]), cur, onPick);
    // WHEN
    card.appendChild(h('div', { class: 'mg-blk' }, h('span', { class: 'kw when' }, 'Quando'),
      typed(EVENTS, r.when.ev, (ev) => { r.when = this._defaults(EVENTS[ev].params, { ev }); this.commit(); this._render(); }),
      h('button', { class: 'mg-x', title: 'Excluir regra', onclick: () => { this.def.rules.splice(i, 1); this.commit(); this._render(); } }, '✕')));
    if (EVENTS[r.when.ev].params.length) card.appendChild(h('div', { class: 'mg-params' }, ...fields(EVENTS[r.when.ev].params, r.when)));
    // IF
    card.appendChild(h('span', { class: 'kw if' }, 'Se (opcional)'));
    r.if.forEach((c, ci) => card.appendChild(h('div', { class: 'mg-blk col' }, h('div', { class: 'mg-row1' }, typed(CONDITIONS, c.c, (k) => { r.if[ci] = this._defaults(CONDITIONS[k].params, { c: k }); this.commit(); this._render(); }),
      h('button', { class: 'mg-x', onclick: () => { r.if.splice(ci, 1); this.commit(); this._render(); } }, '✕')), h('div', { class: 'mg-params' }, ...fields(CONDITIONS[c.c].params, c)))));
    if (r.if.length < LIMITS.condsPerRule) card.appendChild(h('button', { class: 'mg-chip', onclick: () => { r.if.push(this._defaults(CONDITIONS.score.params, { c: 'score' })); this.commit(); this._render(); } }, '＋ condição'));
    // THEN
    card.appendChild(h('span', { class: 'kw then' }, 'Então'));
    r.then.forEach((a, ai) => card.appendChild(h('div', { class: 'mg-blk col' }, h('div', { class: 'mg-row1' }, typed(ACTIONS, a.a, (k) => { r.then[ai] = this._defaults(ACTIONS[k].params, { a: k }); if ('who' in r.then[ai] && NO_ACTOR.has(r.when.ev)) r.then[ai].who = 'all'; this.commit(); this._render(); }),
      h('button', { class: 'mg-x', onclick: () => { r.then.splice(ai, 1); this.commit(); this._render(); } }, '✕')), h('div', { class: 'mg-params' }, ...fields(ACTIONS[a.a].params, a)))));
    if (r.then.length < LIMITS.actionsPerRule) card.appendChild(h('button', { class: 'mg-chip', onclick: () => { const a = this._defaults(ACTIONS.message.params, { a: 'message' }); if (NO_ACTOR.has(r.when.ev)) a.who = 'all'; r.then.push(a); this.commit(); this._render(); } }, '＋ ação'));
    card.appendChild(h('label', { class: 'mg-hint' }, h('input', { type: 'checkbox', checked: !!r.once, onchange: (ev) => { r.once = ev.target.checked; this.commit(); } }), ' só acontece uma vez por partida'));
    return card;
  }

  // ---- game settings
  _tabGame() {
    const def = this.def, M = def.meta, box = h('div', { class: 'mg-ed' }), f = h('div', { class: 'mg-f' });
    const txt = (label, key, max, area) => f.append(h('label', null, label), h(area ? 'textarea' : 'input', { type: 'text', maxlength: max, value: M[key], onchange: (ev) => { M[key] = ev.target.value.slice(0, max); this.commit(); } }));
    const num = (label, key, min, max) => f.append(h('label', null, label), h('input', { type: 'number', min, max, value: M[key], onchange: (ev) => { M[key] = Math.max(min, Math.min(max, Math.round(+ev.target.value) || 0)); if (M.maxPlayers < M.minPlayers) M.maxPlayers = M.minPlayers; this.commit(); this._render(); } }));
    const chk = (label, key) => f.append(h('label', null, label), h('input', { type: 'checkbox', checked: !!M[key], onchange: (ev) => { M[key] = ev.target.checked; this.commit(); } }));
    const sel = (label, opts, cur, fn) => f.append(h('label', null, label), selectOf(opts, cur, fn));
    txt('Nome', 'name', LIMITS.name); txt('Autor', 'author', 24); txt('Descrição', 'description', LIMITS.desc, true); txt('Ícone (emoji)', 'icon', 4);
    f.append(h('label', null, 'Cor'), h('input', { type: 'color', value: M.color, onchange: (ev) => { M.color = ev.target.value; this.commit(); } }));
    sel('Modo', MODES, M.mode, (v) => { M.mode = v; if (v === 'teams' && M.teams.length < 2) M.teams = [{ id: 'red', name: 'Vermelho', color: TEAM_COLORS[0] }, { id: 'blue', name: 'Azul', color: TEAM_COLORS[1] }]; this.commit(); this._render(); });
    num('Mín. jogadores', 'minPlayers', 1, LIMITS.players); num('Máx. jogadores', 'maxPlayers', 1, LIMITS.players); num('Tempo limite (s, 0 = sem)', 'timeLimit', 0, LIMITS.timeLimit);
    num('Vidas (0 = infinitas)', 'lives', 0, 99); sel('Ao morrer', [['respawn', 'Voltar ao checkpoint'], ['eliminate', 'Ser eliminado']], M.onDeath, (v) => { M.onDeath = v; this.commit(); });
    num('Voltas', 'laps', 1, 20); num('Contagem (s)', 'countdown', 0, 10); chk('Jogadores lutam (PvP)', 'pvp'); chk('Jogadores podem construir', 'allowBuild');
    sel('Vitória', WIN_TYPES, def.win.type, (v) => { def.win.type = v; this.commit(); this._render(); });
    if (['score', 'teamScore', 'goal'].includes(def.win.type)) f.append(h('label', null, def.win.type === 'goal' ? 'Quantos precisam chegar' : 'Pontos para vencer'), h('input', { type: 'number', min: 1, max: 9999, value: def.win.target, onchange: (ev) => { def.win.target = Math.max(1, Math.min(9999, Math.round(+ev.target.value) || 1)); this.commit(); } }));
    box.appendChild(f);
    if (M.mode === 'teams') {
      const ts = h('div', { class: 'mg-sec' }, h('h3', null, 'Times'));
      M.teams.forEach((t, i) => ts.appendChild(h('div', { class: 'mg-blk' }, h('input', { type: 'text', value: t.name, maxlength: 20, onchange: (ev) => { t.name = ev.target.value.slice(0, 20) || t.id; this.commit(); } }), h('input', { type: 'color', value: t.color, onchange: (ev) => { t.color = ev.target.value; this.commit(); this._refreshView(); } }),
        M.teams.length > 2 ? h('button', { class: 'mg-x', onclick: () => { M.teams.splice(i, 1); this.commit(); this._render(); } }, '✕') : '')));
      if (M.teams.length < LIMITS.teams) ts.appendChild(h('button', { class: 'mg-chip', onclick: () => { const n = M.teams.length; M.teams.push({ id: 't' + (n + 1), name: 'Time ' + (n + 1), color: TEAM_COLORS[n % 4] }); this.commit(); this._render(); } }, '＋ time'));
      box.appendChild(ts);
    }
    const lo = h('div', { class: 'mg-sec' }, h('h3', null, 'Equipamento inicial (itens)'));
    def.loadout.forEach((l, i) => lo.appendChild(h('div', { class: 'mg-blk' }, h('input', { type: 'text', list: 'mg-items', value: l.item, onchange: (ev) => { l.item = ev.target.value.replace(/[^a-z0-9_:.-]/gi, '').slice(0, 40); this.commit(); } }), h('input', { type: 'number', min: 1, max: 64, value: l.count, onchange: (ev) => { l.count = Math.max(1, Math.min(64, Math.round(+ev.target.value) || 1)); this.commit(); } }), h('button', { class: 'mg-x', onclick: () => { def.loadout.splice(i, 1); this.commit(); this._render(); } }, '✕'))));
    if (def.loadout.length < LIMITS.loadout) lo.appendChild(h('button', { class: 'mg-chip', onclick: () => { def.loadout.push({ item: 'sword', count: 1 }); this.commit(); this._render(); } }, '＋ item'));
    lo.appendChild(h('div', { class: 'mg-hint' }, this.ctx.items ? 'Itens que não existirem são ignorados.' : 'O sistema de itens não está ativo: o equipamento é ignorado.')); box.appendChild(lo);
    const place = h('div', { class: 'mg-sec' }, h('h3', null, 'Lugar do jogo'), h('div', { class: 'mg-hint' }, `Âncora: ${def.anchor.x}, ${def.anchor.y}, ${def.anchor.z} — todas as coordenadas são relativas a ela.`));
    place.appendChild(h('div', { class: 'btn-row' }, h('button', { class: 'btn', onclick: () => { this.api.placeHere(def, 0); this.commit(); this._refreshView(); this._render(); } }, 'Mover o jogo para onde estou'),
      (def.arena.length || def.entities.some((e) => e.type === 'area' || e.type === 'door')) ? h('button', { class: 'btn', onclick: () => this.buildHere(0) }, 'Construir arena aqui') : ''));
    box.appendChild(place);
    return box;
  }

  // ---- file
  _tabFile() {
    const box = h('div', { class: 'mg-ed' }), def = this.def;
    box.appendChild(h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', onclick: () => this.test() }, '▶ Testar agora')));
    box.appendChild(h('div', { class: 'btn-row' },
      h('button', { class: 'btn', onclick: () => { const id = saveGame(def, this.savedId); if (id) { this.savedId = id; this.ctx.ui.toast('Jogo salvo neste navegador'); } else this.ctx.ui.toast('Não foi possível salvar'); } }, '💾 Salvar'),
      h('button', { class: 'btn', onclick: () => this.api.browse() }, '📂 Abrir / Modelos'),
      h('button', { class: 'btn', onclick: () => this.open(emptyGameDef(), '') }, '＋ Novo')));
    const ex = h('div', { class: 'mg-sec' }, h('h3', null, 'Compartilhar'));
    const ta = h('textarea', { readonly: true, placeholder: 'O código aparece aqui…' });
    ex.append(h('div', { class: 'btn-row' },
      h('button', { class: 'btn', onclick: async () => { ta.value = await exportCode(def); ta.select(); } }, 'Gerar código'),
      h('button', { class: 'btn', onclick: async () => { if (!ta.value) ta.value = await exportCode(def); copyText(ta.value, this.ctx); } }, 'Copiar'),
      h('button', { class: 'btn', onclick: async () => { if (!ta.value) ta.value = await exportCode(def); copyText(location.origin + location.pathname + '?game=' + ta.value, this.ctx, 'Link copiado'); } }, 'Copiar link'),
      h('button', { class: 'btn', onclick: () => downloadJson(def) }, 'Baixar .json')), ta);
    box.appendChild(ex);
    const im = h('div', { class: 'mg-sec' }, h('h3', null, 'Importar'));
    const ta2 = h('textarea', { placeholder: 'Cole aqui um código HZG1… ou um link com ?game=…' });
    const note = h('div', { class: 'mg-hint' });
    im.append(ta2, h('div', { class: 'btn-row' }, h('button', { class: 'btn', onclick: async () => { try { const r = await importAny(ta2.value); this.open(r.def, ''); this.ctx.ui.toast(`Importado: ${r.def.meta.name}${r.warnings.length ? ' (com ajustes)' : ''}`); } catch (e) { note.textContent = '⚠ ' + e.message; } } }, 'Importar')), note);
    box.appendChild(im);
    box.appendChild(h('div', { class: 'btn-row' }, h('button', { class: 'btn ghost', onclick: () => this.close() }, 'Sair do editor')));
    return box;
  }

  /** "Testar agora": start the game right here with the current definition. */
  test() {
    const lint = lintGameDef(this.def); if (lint.length) this.ctx.ui.toast(lint[0]);
    const def = structuredClone(this.def);
    if (this.panel) this.panel.close();
    this.view.hide();
    this.session.onChange = () => { if (!this.session.active) { this.session.onChange = null; if (this.on) { this._refreshView(); this.ctx.ui.toast('Teste encerrado — de volta ao editor'); } } };
    this.session.start(def, { rebuild: true, test: true });
  }
}

async function copyText(text, ctx, ok = 'Código copiado') {
  try { await navigator.clipboard.writeText(text); ctx.ui.toast(ok); }
  catch { const t = h('textarea', { value: text }); document.body.appendChild(t); t.select(); try { document.execCommand('copy'); ctx.ui.toast(ok); } catch { ctx.ui.toast('Selecione e copie manualmente'); } t.remove(); }
}
function downloadJson(def) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(def, null, 1)], { type: 'application/json' })); a.download = (def.meta.name || 'minigame').replace(/[^\w-]+/g, '_') + '.hzgame.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
export { copyText, downloadJson };
