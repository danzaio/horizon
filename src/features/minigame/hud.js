// Minigame HUD: timer, scoreboard / team bars, big centre titles (3-2-1-VAI!), results screen. All text goes through textContent (never innerHTML),
// because names and texts can come from other players. Created lazily; removed when the game ends. Fed by runtime.view() or by replicated state.
import './minigame.css';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const fmtT = (s) => { s = Math.max(0, s); const m = Math.floor(s / 60); return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`; };
const clock = (s) => { s = Math.max(0, Math.floor(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export class MgHud {
  /** @param {object} ui ctx.ui @param {string} localId */
  constructor(ui, localId) {
    this.ui = ui; this.localId = localId; this.view = null; this.viewAt = 0; this.def = null; this._tT = 0;
    const root = this.root = el('div', 'mg-hud');
    this.bar = el('div', 'mg-bar'); this.name = el('span', 'mg-name'); this.time = el('span', 'mg-time'); this.info = el('span', 'mg-info'); this.bar.append(this.name, this.time, this.info);
    this.teams = el('div', 'mg-teams'); this.board = el('div', 'mg-board');
    this.title_ = el('div', 'mg-title'); this.tMain = el('div', 'mg-title-main'); this.tSub = el('div', 'mg-title-sub'); this.title_.append(this.tMain, this.tSub);
    this.spec = el('div', 'mg-spec hidden', 'Modo espectador — aguarde o fim da partida');
    root.append(this.bar, this.teams, this.board, this.title_, this.spec);
    ui.hudLayer.appendChild(root); document.body.classList.add('mg-on');
  }

  /** @param {object} view runtime.view()-shaped state @param {object} def GameDef (for names/colours) */
  setView(view, def) { this.view = view; this.viewAt = performance.now(); this.def = def; this._render(); }

  _tc(id) { const t = this.def && this.def.meta.teams.find((x) => x.id === id); return t ? t.color : '#ffffff'; }

  _render() {
    const v = this.view, d = this.def; if (!v || !d) return;
    this.name.textContent = `${d.meta.icon || '🎮'} ${d.meta.name}`;
    const me = v.p.find((r) => r[0] === this.localId);
    const bits = [];
    if (v.ph === 'lobby') bits.push(`Sala: ${v.p.length} jogador(es) — o anfitrião começa com Y`);
    if (v.cp > 0 && me) bits.push(`Checkpoint ${me[7]}/${v.cp}`);
    if (v.laps > 1 && me) bits.push(`Volta ${Math.min(me[6], v.laps)}/${v.laps}`);
    if (d.win.type === 'score' || d.win.type === 'teamScore') bits.push(`Meta: ${d.win.target} pts`);
    if (me && d.meta.lives > 0) bits.push('♥'.repeat(Math.max(0, me[5])) || '☠');
    for (const k of Object.keys(v.v || {}).slice(0, 3)) bits.push(`${k}: ${v.v[k]}`);
    const info = bits.join(' · '); if (info !== this.info.textContent) this.info.textContent = info;
    // team bars
    const tkey = JSON.stringify(v.ts) + d.meta.mode; if (tkey !== this._tk) {
      this._tk = tkey; this.teams.replaceChildren();
      if (d.meta.mode === 'teams') for (const [id, sc] of v.ts) { const t = d.meta.teams.find((x) => x.id === id); if (!t) continue; const b = el('div', 'mg-team'); b.style.setProperty('--c', t.color); b.append(el('span', null, t.name), el('b', null, String(sc))); this.teams.appendChild(b); }
    }
    // scoreboard: top 6, always includes me
    const rows = v.p.slice().sort((a, b) => b[3] - a[3] || (b[4] & 1) - (a[4] & 1)); const top = rows.slice(0, 6); if (me && !top.includes(me)) top[top.length - 1] = me;
    const bkey = JSON.stringify(top); if (bkey !== this._bk) {
      this._bk = bkey; this.board.replaceChildren();
      if (rows.length > 1 || d.win.type === 'score') for (const r of top) {
        const row = el('div', 'mg-row' + (r[0] === this.localId ? ' me' : '') + (r[4] & 2 ? ' out' : '')); row.style.setProperty('--c', r[2] ? this._tc(r[2]) : 'transparent');
        row.append(el('i'), el('span', null, r[1]), el('b', null, d.win.type === 'goal' && r[4] & 4 ? '🏁' : (r[4] & 8 ? '🚩 ' : '') + r[3])); this.board.appendChild(row);
      }
    }
    this.spec.classList.toggle('hidden', !(me && me[4] & 2) || v.ph !== 'running');
    this.tick(performance.now(), true);
  }

  /** Cheap per-frame hook: updates the clock text at ~4 Hz. */
  tick(now, force) {
    if (!this.view || (!force && now - this._tT < 240)) return; this._tT = now;
    const v = this.view, run = v.ph === 'running', t = v.t + (run ? (now - this.viewAt) / 1000 : 0);
    let txt = '';
    if (v.ph === 'running' || v.ph === 'ended') txt = v.tl > 0 ? clock(v.tl - t) : fmtT(t);
    else if (v.ph === 'countdown') txt = 'Preparar…';
    else txt = '—';
    if (txt !== this._tx) { this._tx = txt; this.time.textContent = txt; }
    this.time.classList.toggle('low', v.tl > 0 && v.tl - t < 10 && run);
  }

  /** Big message in the centre of the screen. kind: count | go | info | end */
  title(text, sub, kind = 'info') {
    this.tMain.textContent = text; this.tSub.textContent = sub || ''; this.title_.className = 'mg-title show ' + kind;
    clearTimeout(this._tt); this._tt = setTimeout(() => { this.title_.className = 'mg-title'; }, kind === 'count' ? 850 : kind === 'end' ? 3200 : 2200);
    void this.title_.offsetWidth;
  }

  /**
   * Results screen (modal panel). `canRestart` = this client is the authority. cb = { again(), close() }
   * @param {object} res runtime.results
   */
  showResults(res, def, canRestart, cb, note = '') {
    const body = el('div', 'mg-results');
    const w = res.winner;
    const banner = el('div', 'mg-banner'); banner.style.setProperty('--c', w && w.kind === 'team' ? this._tc(w.id) : def.meta.color);
    banner.append(el('div', 'mg-banner-t', w ? (w.kind === 'team' ? `🏆 Time ${w.name} venceu!` : `🏆 ${w.name} venceu!`) : 'Fim de jogo'), el('div', 'mg-banner-s', `${def.meta.name} · ${fmtT(res.time)}${note ? ' · ' + note : ''}`));
    body.appendChild(banner);
    if (res.teams && res.teams.length) { const tb = el('div', 'mg-rteams'); for (const t of res.teams) { const b = el('div', 'mg-team'); b.style.setProperty('--c', t.color); b.append(el('span', null, t.name), el('b', null, String(t.score))); tb.appendChild(b); } body.appendChild(tb); }
    const tbl = el('div', 'mg-table'), head = el('div', 'mg-trow head');
    head.append(el('span', null, '#'), el('span', null, 'Jogador'), el('span', null, 'Pontos'), el('span', null, 'Tempo')); tbl.appendChild(head);
    for (const r of res.rows.slice(0, 16)) {
      const row = el('div', 'mg-trow' + (r.id === this.localId ? ' me' : '')); row.style.setProperty('--c', r.team ? this._tc(r.team) : 'transparent');
      row.append(el('span', null, String(r.rank)), el('span', null, (r.rank === 1 && w ? '🥇 ' : '') + r.name), el('span', null, String(r.score)), el('span', null, r.time != null ? fmtT(r.time) : '—')); tbl.appendChild(row);
    }
    body.appendChild(tbl);
    const btns = el('div', 'btn-row');
    if (canRestart) { const b = el('button', 'btn primary', 'Jogar de novo'); b.onclick = () => { panel && panel.close(); cb.again(); }; btns.appendChild(b); }
    else btns.appendChild(el('div', 'note', 'Aguardando o anfitrião reiniciar…'));
    const c = el('button', 'btn ghost', 'Sair do jogo'); c.onclick = () => { panel && panel.close(); cb.close(); }; btns.appendChild(c);
    body.appendChild(btns);
    const panel = this.ui.panel({ id: 'mg-results', title: 'Resultados', content: body, width: 520, onClose: () => {} });
    return panel;
  }

  setSpectator(on) { this.spec.classList.toggle('hidden', !on); }

  dispose() { clearTimeout(this._tt); this.root.remove(); document.body.classList.remove('mg-on'); }
}
