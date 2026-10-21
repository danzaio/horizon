// GameDef schema: the single source of truth for what a minigame can contain. Pure data + validation (no DOM, no THREE), so it runs in node tests.
// A GameDef is untrusted JSON (it can come from another player): `validateGameDef` rebuilds it field by field, clamps every number,
// drops unknown keys and caps every list. The rule editor UI is generated from the same descriptor tables (EVENTS / CONDITIONS / ACTIONS).
import { BLOCKS } from '../../shared/blocks.js';

export const VERSION = 1;

/** Hard limits: an imported game can never freeze the host. */
export const LIMITS = {
  entities: 300, rules: 200, actionsPerRule: 16, condsPerRule: 8, actionsPerTick: 64, blocksPerTick: 2000, text: 120, name: 40, desc: 400,
  coord: 4096, size: 96, area: 120000, teams: 4, loadout: 12, vars: 16, arena: 160, arenaBlocks: 250000, timeLimit: 3600, players: 16,
};

const clamp = (v, lo, hi, def) => { v = +v; if (!Number.isFinite(v)) return def; return v < lo ? lo : v > hi ? hi : v; };
const int = (v, lo, hi, def) => Math.round(clamp(v, lo, hi, def));
/** Strips control characters and caps the length. Always used for text that is later shown with textContent. */
export const cleanText = (v, max = LIMITS.text) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f<>]/g, ' ').trim().slice(0, max) : '');
const cleanId = (v, def = '') => (typeof v === 'string' && /^[A-Za-z0-9_-]{1,16}$/.test(v) ? v : def);
const cleanColor = (v, def = '#ffb454') => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : def);
const cleanItem = (v) => (typeof v === 'string' && /^[a-z0-9_:.-]{1,40}$/.test(v) ? v : '');

// ---- block materials (stored by NAME so a game survives block-id changes) ----
export const MATERIALS = BLOCKS.filter((b) => b && b.placeable && b.render === 1).map((b) => b.name);
export const MATERIAL_PT = { stone: 'Pedra', dirt: 'Terra', grass: 'Grama', sand: 'Areia', gravel: 'Cascalho', snow: 'Neve', ice: 'Gelo', oak_log: 'Tronco', planks: 'Tábuas', cobblestone: 'Pedregulho', glass: 'Vidro',
  glowstone: 'Pedra luminosa', bricks: 'Tijolos', sandstone: 'Arenito', terracotta: 'Terracota', white_terracotta: 'Terracota branca', red_terracotta: 'Terracota vermelha', yellow_terracotta: 'Terracota amarela', brown_terracotta: 'Terracota marrom', hay: 'Feno',
  gold_ore: 'Ouro', iron_ore: 'Ferro', diamond_ore: 'Diamante', coal_ore: 'Carvão', red_sand: 'Areia vermelha', pink_coral: 'Coral rosa', purple_coral: 'Coral roxo', red_coral: 'Coral vermelho', yellow_coral: 'Coral amarelo', snowy_grass: 'Grama nevada', dirt_path: 'Caminho' };
export const matLabel = (m) => MATERIAL_PT[m] || m;
const ID_BY_NAME = new Map(BLOCKS.filter(Boolean).map((b) => [b.name, b.id]));
/** Block id for a material name (air for 'air' / unknown). */
export const materialId = (name) => (name === 'air' ? 0 : ID_BY_NAME.get(name) ?? 1);
const cleanMat = (v, def = 'stone') => (typeof v === 'string' && (v === 'air' || MATERIALS.includes(v)) ? v : def);

// ---- parameter descriptors: { key, kind, label, def, min?, max?, options?:[[value,label]] } ----
// kinds: int num bool text select team entity item material
const P = {
  entity: (key = 'entity', label = 'Objeto', types) => ({ key, kind: 'entity', label, def: '', types }),
  num: (key, label, def, min, max, step = 1) => ({ key, kind: 'num', label, def, min, max, step }),
  int: (key, label, def, min, max) => ({ key, kind: 'int', label, def, min, max, step: 1 }),
  text: (key, label, def = '', max = LIMITS.text) => ({ key, kind: 'text', label, def, max }),
  sel: (key, label, def, options) => ({ key, kind: 'select', label, def, options }),
  bool: (key, label, def = false) => ({ key, kind: 'bool', label, def }),
  team: (key = 'team', label = 'Time', def = '') => ({ key, kind: 'team', label, def }),
  item: (key = 'item', label = 'Item', def = '') => ({ key, kind: 'item', label, def }),
  mat: (key = 'material', label = 'Material', def = 'stone') => ({ key, kind: 'material', label, def }),
  name: (key, label, def = 'a') => ({ key, kind: 'name', label, def }),
};
export const WHO = [['actor', 'Quem ativou'], ['all', 'Todos'], ['team', 'Time de quem ativou'], ['others', 'Os outros'], ['enemies', 'Times adversários'], ['alive', 'Quem está vivo'], ['random', 'Um jogador aleatório'], ['victim', 'Quem foi pego / derrotado']];
export const OPS = [['>=', 'pelo menos'], ['>', 'mais que'], ['==', 'igual a'], ['!=', 'diferente de'], ['<=', 'no máximo'], ['<', 'menos que']];
const who = () => P.sel('who', 'Para quem', 'actor', WHO);

export const ENTITY_TYPES = {
  spawn: { label: 'Ponto de partida', icon: '🟢', color: '#4ade80', size: [1, 1, 1], props: [P.team('team', 'Time (vazio = todos)')], help: 'Onde os jogadores nascem. Com times, cada time usa os seus.' },
  goal: { label: 'Chegada', icon: '🏁', color: '#ffd54a', size: [3, 3, 3], props: [P.bool('needCp', 'Exige todos os checkpoints', false)], help: 'Quem encostar termina a prova (ou completa uma volta).' },
  checkpoint: { label: 'Checkpoint', icon: '🔵', color: '#60a5fa', size: [3, 3, 3], props: [P.int('order', 'Ordem', 1, 1, 99)], help: 'Salva o progresso: ao cair, você volta aqui.' },
  killzone: { label: 'Zona mortal', icon: '☠️', color: '#ef4444', size: [8, 2, 8], props: [], help: 'Quem tocar morre (ou perde uma vida).' },
  trigger: { label: 'Gatilho', icon: '⚡', color: '#c084fc', size: [3, 3, 3], props: [], help: 'Volume invisível usado nas regras: "quando alguém entra em…".' },
  pad: { label: 'Plataforma', icon: '⏫', color: '#fb923c', size: [2, 1, 2], props: [P.sel('kind', 'Efeito', 'jump', [['boost', 'Impulso para frente'], ['jump', 'Pulo alto'], ['teleport', 'Teleporte']]), P.num('power', 'Força', 14, 4, 40), P.entity('target', 'Destino (teleporte)')], help: 'Lança o jogador ou o teleporta.' },
  itemGiver: { label: 'Entrega de item', icon: '🎁', color: '#f472b6', size: [2, 2, 2], props: [P.item(), P.int('count', 'Quantidade', 1, 1, 64), P.num('cooldown', 'Espera (s)', 20, 0, 600)], help: 'Dá um item a quem entrar (se o sistema de itens existir).' },
  button: { label: 'Botão', icon: '🔘', color: '#facc15', size: [1, 1, 1], props: [P.num('cooldown', 'Espera (s)', 1, 0, 600)], help: 'Quem pisar aperta. Use a regra "quando o botão é apertado".' },
  door: { label: 'Porta', icon: '🚪', color: '#a8a29e', size: [3, 4, 1], props: [P.mat(), P.bool('open', 'Começa aberta', false)], help: 'Bloqueia a passagem; abra/feche com regras.' },
  sign: { label: 'Placa', icon: '💬', color: '#e5e7eb', size: [2, 2, 2], props: [P.text('text', 'Texto', 'Olá!')], help: 'Mostra uma mensagem a quem chegar perto.' },
  flag: { label: 'Bandeira / base', icon: '🚩', color: '#f87171', size: [3, 4, 3], props: [P.team('team', 'Time')], help: 'Capture a bandeira inimiga e leve até a sua base.' },
  zone: { label: 'Zona de pontos', icon: '👑', color: '#34d399', size: [8, 4, 8], props: [P.int('rate', 'Pontos por vez', 1, 1, 50), P.num('hold', 'A cada (s)', 1, 0.2, 30, 0.1)], help: 'Quem domina sozinho a zona ganha pontos.' },
  area: { label: 'Área de blocos', icon: '🧱', color: '#38bdf8', size: [8, 1, 8], props: [P.sel('kind', 'Tipo', 'floor', [['floor', 'Chão'], ['wall', 'Parede']]), P.mat('material', 'Material', 'snow'), P.bool('breakable', 'Jogadores podem quebrar', false), P.num('crumble', 'Some depois de pisar (s, 0 = não)', 0, 0, 10, 0.1), P.bool('restore', 'Reconstruir a cada partida (apaga o que houver)', false)], help: 'Região de blocos do jogo (chão do Spleef, TNT Run…).' },
};
export const ENTITY_ORDER = ['spawn', 'goal', 'checkpoint', 'killzone', 'trigger', 'pad', 'itemGiver', 'button', 'door', 'sign', 'flag', 'zone', 'area'];

export const EVENTS = {
  gameStart: { label: 'Quando o jogo começa', params: [] },
  playerEnter: { label: 'Quando um jogador entra em', params: [P.entity()] },
  playerExit: { label: 'Quando um jogador sai de', params: [P.entity()] },
  playerDied: { label: 'Quando um jogador morre', params: [] },
  playerKilled: { label: 'Quando um jogador derrota outro', params: [] },
  blockBroken: { label: 'Quando um bloco é quebrado em', params: [P.entity('entity', 'Área', ['area'])] },
  itemUsed: { label: 'Quando um item é usado', params: [P.item()] },
  timer: { label: 'Quando o cronômetro acaba', params: [P.name('id', 'Cronômetro')] },
  scoreReached: { label: 'Quando alguém chega a (pontos)', params: [P.int('value', 'Pontos', 5, 1, 9999)] },
  buttonPressed: { label: 'Quando o botão é apertado', params: [P.entity('entity', 'Botão', ['button'])] },
  tick: { label: 'A cada tantos segundos', params: [P.num('every', 'Segundos', 5, 0.5, 600, 0.5)] },
  playersTouch: { label: 'Quando um jogador encosta em outro', params: [P.team('team', 'Time de quem caça'), P.team('other', 'Time de quem é pego')] },
};
export const CONDITIONS = {
  team: { label: 'o jogador é do time', params: [P.team()] },
  score: { label: 'pontos do jogador', params: [P.sel('op', 'é', '>=', OPS), P.int('value', 'Valor', 1, -9999, 9999)] },
  teamScore: { label: 'pontos do time', params: [P.team(), P.sel('op', 'é', '>=', OPS), P.int('value', 'Valor', 1, -9999, 9999)] },
  teamCount: { label: 'jogadores vivos no time', params: [P.team(), P.sel('op', 'é', '<=', OPS), P.int('value', 'Valor', 0, 0, 99)] },
  aliveCount: { label: 'jogadores vivos', params: [P.sel('op', 'é', '<=', OPS), P.int('value', 'Valor', 1, 0, 99)] },
  hasItem: { label: 'o jogador tem o item', params: [P.item()] },
  time: { label: 'segundos de jogo', params: [P.sel('op', 'é', '>=', OPS), P.int('value', 'Segundos', 30, 0, 3600)] },
  random: { label: 'sorte (chance %)', params: [P.int('percent', 'Chance %', 50, 1, 100)] },
  variable: { label: 'variável', params: [P.name('name', 'Nome'), P.sel('op', 'é', '>=', OPS), P.int('value', 'Valor', 1, -9999, 9999)] },
};
export const ACTIONS = {
  teleport: { label: 'Teleportar', params: [who(), P.entity('entity', 'Para', ['spawn', 'trigger', 'checkpoint', 'goal', 'zone', 'flag', 'area', 'pad', 'sign', 'button'])] },
  giveItem: { label: 'Dar item', params: [who(), P.item(), P.int('count', 'Quantidade', 1, 1, 64)] },
  setLoadout: { label: 'Dar o equipamento do jogo', params: [who()] },
  damage: { label: 'Causar dano', params: [who(), P.num('amount', 'Dano', 4, 0.5, 100, 0.5)] },
  heal: { label: 'Curar', params: [who(), P.num('amount', 'Vida', 4, 0.5, 100, 0.5)] },
  kill: { label: 'Eliminar (matar)', params: [who()] },
  respawn: { label: 'Reaparecer no último checkpoint', params: [who()] },
  setBlock: { label: 'Trocar o bloco no canto de', params: [P.entity('entity', 'Objeto'), P.mat()] },
  fillArea: { label: 'Preencher a área com', params: [P.entity('entity', 'Área', ['area', 'door', 'trigger']), P.mat()] },
  removeBlocks: { label: 'Remover os blocos da área', params: [P.entity('entity', 'Área', ['area', 'door', 'trigger'])] },
  addScore: { label: 'Dar pontos', params: [who(), P.int('amount', 'Pontos', 1, -999, 999), P.sel('to', 'Conta para', 'player', [['player', 'Jogador (e seu time)'], ['team', 'Só o time']])] },
  setVar: { label: 'Definir variável', params: [P.name('name', 'Nome'), P.sel('mode', 'Modo', 'set', [['set', 'Definir como'], ['add', 'Somar']]), P.int('value', 'Valor', 1, -9999, 9999)] },
  setTeam: { label: 'Mudar de time', params: [who(), P.team('team', 'Para o time')] },
  message: { label: 'Mostrar mensagem', params: [who(), P.text('text', 'Texto', 'Muito bem!')] },
  title: { label: 'Mostrar título grande', params: [who(), P.text('text', 'Título', 'Vai!', 40), P.text('sub', 'Subtítulo', '', 60)] },
  sound: { label: 'Tocar som', params: [who(), P.sel('name', 'Som', 'ding', [['ding', 'Ding'], ['win', 'Vitória'], ['lose', 'Derrota'], ['tick', 'Tique'], ['boom', 'Estrondo'], ['jump', 'Pulo']])] },
  startTimer: { label: 'Iniciar cronômetro', params: [P.name('id', 'Nome', 't1'), P.num('seconds', 'Segundos', 10, 0.5, 3600, 0.5), P.bool('repeat', 'Repetir', false)] },
  stopTimer: { label: 'Parar cronômetro', params: [P.name('id', 'Nome', 't1')] },
  openDoor: { label: 'Abrir porta', params: [P.entity('entity', 'Porta', ['door'])] },
  closeDoor: { label: 'Fechar porta', params: [P.entity('entity', 'Porta', ['door'])] },
  eliminate: { label: 'Tirar do jogo (espectador)', params: [who()] },
  endGame: { label: 'Terminar o jogo — vencedor', params: [P.sel('winner', 'Vencedor', 'actor', [['actor', 'Quem ativou'], ['team', 'Time de quem ativou'], ['top', 'Quem tem mais pontos'], ['topTeam', 'Time com mais pontos'], ['none', 'Ninguém']]), P.team('team', 'Ou este time (opcional)')] },
};

export const MODES = [['solo', 'Solo'], ['coop', 'Cooperativo'], ['ffa', 'Todos contra todos'], ['teams', 'Times']];
export const WIN_TYPES = [['goal', 'Primeiro a chegar'], ['lastAlive', 'Último de pé'], ['score', 'Mais pontos'], ['teamScore', 'Pontos do time'], ['time', 'Sobreviver até o tempo acabar'], ['none', 'Só pelas regras']];
export const TEAM_COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#eab308'];

// ---- generic descriptor-driven cleaning ----
function cleanParam(spec, raw, ctx) {
  switch (spec.kind) {
    case 'int': return int(raw, spec.min, spec.max, spec.def);
    case 'num': { const v = clamp(raw, spec.min, spec.max, spec.def); return Math.round(v * 100) / 100; }
    case 'bool': return raw === undefined ? !!spec.def : !!raw;
    case 'text': return cleanText(raw ?? spec.def, spec.max || LIMITS.text);
    case 'select': return spec.options.some((o) => o[0] === raw) ? raw : spec.def;
    case 'team': return typeof raw === 'string' && (ctx.teams.has(raw) || raw === '') ? raw : '';
    case 'entity': { const id = cleanId(raw); return id && ctx.ids.has(id) ? id : ''; }
    case 'item': return cleanItem(raw);
    case 'material': return cleanMat(raw, spec.def);
    case 'name': return typeof raw === 'string' && /^[a-z][a-z0-9_]{0,15}$/i.test(raw) ? raw : spec.def;
    default: return spec.def;
  }
}
function cleanParams(specs, raw, ctx, out = {}) {
  raw = raw && typeof raw === 'object' ? raw : {};
  for (const s of specs) out[s.key] = cleanParam(s, raw[s.key], ctx);
  return out;
}

/** Fresh empty game. */
export function emptyGameDef() {
  return {
    v: VERSION,
    meta: { name: 'Meu jogo', author: '', description: '', color: '#ffb454', icon: '🎮', mode: 'solo', minPlayers: 1, maxPlayers: 8, timeLimit: 0, lives: 0, onDeath: 'respawn', pvp: false, allowBuild: false, laps: 1, countdown: 3, resultsTime: 12, teamStart: 'balance',
      teams: [] },
    anchor: { x: 0, y: 64, z: 0 },
    entities: [], rules: [], loadout: [], vars: {}, win: { type: 'goal', target: 1 }, arena: [],
  };
}

/**
 * Validates and normalises untrusted GameDef JSON. Never throws on bad fields (they are clamped/dropped and reported in `warnings`),
 * only on input that is not a game at all.
 * @returns {{def:object, warnings:string[]}}
 */
export function validateGameDef(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Isso não parece um jogo (JSON inválido).');
  if (raw.v !== VERSION) throw new Error(`Versão de jogo não suportada (${String(raw.v).slice(0, 8)}).`);
  const warnings = [], warn = (s) => { if (warnings.length < 30) warnings.push(s); };
  const d = emptyGameDef(), m = raw.meta && typeof raw.meta === 'object' ? raw.meta : {};
  const M = d.meta;
  M.name = cleanText(m.name, LIMITS.name) || 'Jogo sem nome'; M.author = cleanText(m.author, 24); M.description = cleanText(m.description, LIMITS.desc);
  M.color = cleanColor(m.color); M.icon = cleanText(m.icon, 4) || '🎮';
  M.mode = MODES.some((x) => x[0] === m.mode) ? m.mode : 'solo';
  M.minPlayers = int(m.minPlayers, 1, LIMITS.players, 1); M.maxPlayers = int(m.maxPlayers, M.minPlayers, LIMITS.players, 8);
  M.timeLimit = int(m.timeLimit, 0, LIMITS.timeLimit, 0); M.lives = int(m.lives, 0, 99, 0);
  M.onDeath = ['respawn', 'eliminate'].includes(m.onDeath) ? m.onDeath : 'respawn';
  M.teamStart = m.teamStart === 'first' ? 'first' : 'balance'; M.pvp = !!m.pvp; M.allowBuild = !!m.allowBuild; M.laps = int(m.laps, 1, 20, 1); M.countdown = int(m.countdown, 0, 10, 3); M.resultsTime = int(m.resultsTime, 3, 60, 12);
  const teams = new Map();
  if (Array.isArray(m.teams)) for (const t of m.teams.slice(0, LIMITS.teams)) {
    const id = cleanId(t && t.id); if (!id || teams.has(id)) continue;
    const o = { id, name: cleanText(t.name, 20) || id, color: cleanColor(t.color, TEAM_COLORS[teams.size % 4]) }; teams.set(id, o); M.teams.push(o);
  }
  if (M.mode === 'teams' && M.teams.length < 2) { warn('Modo times precisa de 2 times: criei Vermelho e Azul.'); for (const [i, n] of ['Vermelho', 'Azul'].entries()) if (M.teams.length <= i) { const o = { id: ['red', 'blue'][i], name: n, color: TEAM_COLORS[i] }; teams.set(o.id, o); M.teams[i] = o; } }
  const a = raw.anchor && typeof raw.anchor === 'object' ? raw.anchor : {};
  d.anchor = { x: int(a.x, -30000000, 30000000, 0), y: int(a.y, 1, 180, 64), z: int(a.z, -30000000, 30000000, 0) };

  // entities (ids first, so references can be checked)
  const ents = Array.isArray(raw.entities) ? raw.entities : [];
  if (ents.length > LIMITS.entities) warn(`Só os primeiros ${LIMITS.entities} objetos foram mantidos.`);
  const ids = new Set(), pre = [];
  for (const e of ents.slice(0, LIMITS.entities)) {
    if (!e || typeof e !== 'object' || !ENTITY_TYPES[e.type]) { warn('Um objeto desconhecido foi ignorado.'); continue; }
    let id = cleanId(e.id); if (!id || ids.has(id)) id = ''; if (id) ids.add(id);
    pre.push({ e, id });
  }
  let nextId = 1; const newId = () => { while (ids.has('e' + nextId)) nextId++; const id = 'e' + nextId; ids.add(id); return id; };
  const ctx = { teams: new Set(teams.keys()), ids };
  for (const { e, id } of pre) {
    const T = ENTITY_TYPES[e.type], c = (k, i) => int(e[k], -LIMITS.coord, LIMITS.coord, 0);
    const ent = { id: id || newId(), type: e.type, x: c('x'), y: int(e.y, -LIMITS.coord, LIMITS.coord, 0), z: c('z'),
      w: int(e.w, 1, LIMITS.size, T.size[0]), h: int(e.h, 1, LIMITS.size, T.size[1]), d: int(e.d, 1, LIMITS.size, T.size[2]), name: cleanText(e.name, 24), p: {} };
    if (ent.w * ent.h * ent.d > LIMITS.area) { ent.w = ent.h = ent.d = 1; warn('Um objeto grande demais foi encolhido.'); }
    cleanParams(T.props, e.p, ctx, ent.p); d.entities.push(ent);
  }

  // rules
  const rules = Array.isArray(raw.rules) ? raw.rules : [];
  if (rules.length > LIMITS.rules) warn(`Só as primeiras ${LIMITS.rules} regras foram mantidas.`);
  for (const r of rules.slice(0, LIMITS.rules)) {
    if (!r || typeof r !== 'object' || !r.when || !EVENTS[r.when.ev]) { warn('Uma regra inválida foi ignorada.'); continue; }
    const when = cleanParams(EVENTS[r.when.ev].params, r.when, ctx, { ev: r.when.ev });
    const cond = [], act = [];
    for (const c of (Array.isArray(r.if) ? r.if : []).slice(0, LIMITS.condsPerRule)) if (c && CONDITIONS[c.c]) cond.push(cleanParams(CONDITIONS[c.c].params, c, ctx, { c: c.c }));
    for (const a2 of (Array.isArray(r.then) ? r.then : []).slice(0, LIMITS.actionsPerRule)) if (a2 && ACTIONS[a2.a]) act.push(cleanParams(ACTIONS[a2.a].params, a2, ctx, { a: a2.a }));
    if (!act.length) { warn('Uma regra sem ações foi ignorada.'); continue; }
    d.rules.push({ id: cleanId(r.id, 'r' + (d.rules.length + 1)), name: cleanText(r.name, 40), when, if: cond, then: act, once: !!r.once });
  }
  if (Array.isArray(raw.loadout)) for (const l of raw.loadout.slice(0, LIMITS.loadout)) { const item = cleanItem(l && l.item); if (item) d.loadout.push({ item, count: int(l.count, 1, 64, 1) }); }
  if (raw.vars && typeof raw.vars === 'object') for (const k of Object.keys(raw.vars).slice(0, LIMITS.vars)) if (/^[a-z][a-z0-9_]{0,15}$/i.test(k)) d.vars[k] = int(raw.vars[k], -9999, 9999, 0);
  const w = raw.win && typeof raw.win === 'object' ? raw.win : {};
  d.win = { type: WIN_TYPES.some((x) => x[0] === w.type) ? w.type : 'goal', target: int(w.target, 1, 9999, 1) };
  if (Array.isArray(raw.arena)) {
    let vol = 0;
    for (const o of raw.arena.slice(0, LIMITS.arena)) {
      if (!o || typeof o !== 'object') continue;
      const op = { x: int(o.x, -LIMITS.coord, LIMITS.coord, 0), y: int(o.y, -LIMITS.coord, LIMITS.coord, 0), z: int(o.z, -LIMITS.coord, LIMITS.coord, 0), w: int(o.w, 1, LIMITS.size, 1), h: int(o.h, 1, LIMITS.size, 1), d: int(o.d, 1, LIMITS.size, 1), material: cleanMat(o.material) };
      if (o.shape === 'hollow') op.shape = 'hollow';
      vol += op.w * op.h * op.d; if (vol > LIMITS.arenaBlocks) { warn('A arena era grande demais; foi cortada.'); break; }
      d.arena.push(op);
    }
  }
  return { def: d, warnings };
}

/** Quick structural problems the creator should fix before sharing (shown in the editor). */
export function lintGameDef(def) {
  const out = [], count = (t) => def.entities.filter((e) => e.type === t).length;
  if (!count('spawn')) out.push('Falta um ponto de partida (🟢).');
  if (def.win.type === 'goal' && !count('goal')) out.push('Falta a chegada (🏁) — ou mude a regra de vitória.');
  if (def.win.type === 'score' && !def.rules.some((r) => r.then.some((a) => a.a === 'addScore')) && !count('zone')) out.push('Ninguém ganha pontos: crie uma regra "Dar pontos".');
  if (def.win.type === 'lastAlive' && def.meta.onDeath !== 'eliminate') out.push('"Último de pé" funciona melhor com "ao morrer: ser eliminado".');
  return out;
}

/** World-space AABB of an entity: [x0,y0,z0,x1,y1,z1]. */
export function entityBox(def, e, out = []) {
  const a = def.anchor; out[0] = a.x + e.x; out[1] = a.y + e.y; out[2] = a.z + e.z; out[3] = out[0] + e.w; out[4] = out[1] + e.h; out[5] = out[2] + e.d; return out;
}
/** Next free entity id. */
export function nextEntityId(def) { const used = new Set(def.entities.map((e) => e.id)); let i = 1; while (used.has('e' + i)) i++; return 'e' + i; }
/** Default props for a new entity of `type`. */
export function defaultProps(type, def) {
  const o = {}; for (const s of ENTITY_TYPES[type].props) o[s.key] = s.def;
  if (type === 'spawn' || type === 'flag') o.team = '';
  if (type === 'checkpoint') o.order = def.entities.filter((e) => e.type === 'checkpoint').length + 1;
  return o;
}
export { cleanParam };
