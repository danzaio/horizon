// Ready-made minigames, generated in code as plain GameDefs (data!). Each one carries its own arena (`arena` ops) so "Construir arena aqui" builds a
// playable map, and the same def is what gets exported/shared. `lift` = how many blocks above the player the arena is built (sky arenas never
// collide with terrain and need no pit: falling = kill zone).
import { emptyGameDef, validateGameDef, TEAM_COLORS } from './schema.js';

function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function builder(meta) {
  const d = emptyGameDef(); Object.assign(d.meta, meta);
  const ent = (type, x, y, z, w, h, dd, p = {}, name = '') => { const id = 'e' + (d.entities.length + 1); d.entities.push({ id, type, x, y, z, w, h, d: dd, p, name }); return id; };
  const fill = (x, y, z, w, h, dd, material, shape) => d.arena.push({ x, y, z, w, h, d: dd, material, shape });
  const rule = (when, then, cond = [], extra = {}) => d.rules.push(Object.assign({ id: 'r' + (d.rules.length + 1), when, if: cond, then }, extra));
  return { d, ent, fill, rule };
}

function parkour() {
  const { d, ent, fill, rule } = builder({ name: 'Parkour', icon: '🏃', color: '#60a5fa', mode: 'ffa', minPlayers: 1, maxPlayers: 8, countdown: 3, onDeath: 'respawn',
    description: 'Pule de plataforma em plataforma até a chegada dourada. Cada checkpoint salva seu progresso; cair só custa tempo. Vence quem chegar primeiro (ou bata seu recorde sozinho).' });
  const R = rng(7), mats = ['planks', 'cobblestone', 'bricks', 'sandstone', 'terracotta', 'white_terracotta'];
  fill(-2, -1, -2, 5, 1, 5, 'stone'); ent('spawn', 0, 0, 0, 1, 1, 1);
  let x = 0, y = -1, z = 0, minY = -1, cp = 0;
  for (let i = 1; i <= 24; i++) {
    const up = R() < 0.22 && y < 6 ? 1 : R() < 0.12 ? -1 : 0;           // climbing steps keep the gap short (walking jumps clear ~3 blocks, +1 up needs less)
    z += 4 + (!up && R() < 0.3 ? 1 : 0); x = Math.max(-8, Math.min(8, x + Math.round((R() - 0.5) * 4))); y += up;
    minY = Math.min(minY, y);
    if (i % 6 === 0) { fill(x - 1, y, z - 1, 4, 1, 4, 'stone'); ent('checkpoint', x - 1, y + 1, z - 1, 4, 3, 4, { order: ++cp }); }
    else fill(x, y, z, 2, 1, 2, mats[(R() * mats.length) | 0]);
  }
  z += 5; fill(x - 2, y, z - 2, 5, 1, 5, 'gold_ore'); ent('goal', x - 1, y + 1, z - 1, 3, 4, 3);
  ent('killzone', -60, minY - 14, -30, 121, 2, z + 60);
  rule({ ev: 'gameStart' }, [{ a: 'message', who: 'all', text: 'Chegue até a plataforma dourada! Cair volta ao último checkpoint.' }]);
  d.win = { type: 'goal', target: 1 };
  return d;
}

function spleef() {
  const { d, ent, fill, rule } = builder({ name: 'Spleef', icon: '❄️', color: '#7dd3fc', mode: 'ffa', minPlayers: 2, maxPlayers: 8, countdown: 5, onDeath: 'eliminate', timeLimit: 300,
    description: 'Quebre o chão de neve debaixo dos adversários! Quem cair é eliminado. O último de pé vence. (Sozinho, tente não cair.)' });
  ent('area', 0, -1, 0, 24, 1, 24, { kind: 'floor', material: 'snow', breakable: true, crumble: 0, restore: true }, 'Chão de neve');
  ent('area', 0, -5, 0, 24, 1, 24, { kind: 'floor', material: 'snow', breakable: true, crumble: 0, restore: true }, 'Segundo andar');
  for (const [x, z] of [[3, 3], [20, 3], [3, 20], [20, 20]]) ent('spawn', x, 0, z, 1, 1, 1);
  ent('killzone', -20, -16, -20, 64, 2, 64);
  fill(-1, 0, -1, 1, 3, 26, 'glass'); fill(24, 0, -1, 1, 3, 26, 'glass'); // low glass rails on two sides: look, don't trap
  rule({ ev: 'gameStart' }, [{ a: 'title', who: 'all', text: 'QUEBRE O CHÃO!', sub: 'Quem cair está fora' }]);
  d.win = { type: 'lastAlive', target: 1 };
  return d;
}

function tntrun() {
  const { d, ent, rule } = builder({ name: 'TNT Run', icon: '💥', color: '#f87171', mode: 'ffa', minPlayers: 2, maxPlayers: 8, countdown: 5, onDeath: 'eliminate', timeLimit: 300,
    description: 'O chão desaparece 0,6 s depois que você pisa! Corra sem parar. Se cair no andar de baixo, continue correndo — se cair no vazio, está fora. Último de pé vence.' });
  ent('area', 0, -1, 0, 26, 1, 26, { kind: 'floor', material: 'sand', breakable: false, crumble: 0.6, restore: true }, 'Andar 1');
  ent('area', 0, -6, 0, 26, 1, 26, { kind: 'floor', material: 'gravel', breakable: false, crumble: 0.6, restore: true }, 'Andar 2');
  for (const [x, z] of [[4, 4], [21, 4], [4, 21], [21, 21], [12, 12]]) ent('spawn', x, 0, z, 1, 1, 1);
  ent('killzone', -20, -18, -20, 66, 2, 66);
  rule({ ev: 'gameStart' }, [{ a: 'title', who: 'all', text: 'CORRA!', sub: 'O chão some atrás de você' }]);
  d.win = { type: 'lastAlive', target: 1 };
  return d;
}

function corrida() {
  const { d, ent, fill, rule } = builder({ name: 'Corrida', icon: '🏁', color: '#fbbf24', mode: 'ffa', minPlayers: 1, maxPlayers: 8, countdown: 4, laps: 3, onDeath: 'respawn',
    description: 'Três voltas numa pista oval. Passe pelos 3 checkpoints a cada volta e cruze a linha de chegada. Use as plataformas de impulso nas retas!' });
  fill(0, -1, 0, 44, 1, 7, 'stone'); fill(0, -1, 25, 44, 1, 7, 'stone'); fill(0, -1, 0, 7, 1, 32, 'stone'); fill(37, -1, 0, 7, 1, 32, 'stone');
  fill(12, -1, 0, 2, 1, 7, 'white_terracotta'); // finish stripe
  fill(0, 0, 0, 44, 1, 1, 'bricks'); fill(0, 0, 31, 44, 1, 1, 'bricks'); // low border on the outer sides
  ent('goal', 12, 0, 0, 2, 4, 7, { needCp: true }, 'Chegada');
  ent('checkpoint', 37, 0, 0, 7, 4, 7, { order: 1 }); ent('checkpoint', 37, 0, 25, 7, 4, 7, { order: 2 }); ent('checkpoint', 0, 0, 25, 7, 4, 7, { order: 3 });
  for (let i = 0; i < 4; i++) ent('spawn', 16 + (i >> 1) * 2, 0, 1 + (i & 1) * 3 + (i & 1), 1, 1, 1);
  ent('pad', 26, 0, 1, 2, 1, 2, { kind: 'boost', power: 16 }); ent('pad', 22, 0, 28, 2, 1, 2, { kind: 'boost', power: 16 });
  ent('killzone', -30, -14, -30, 104, 2, 92);
  rule({ ev: 'gameStart' }, [{ a: 'message', who: 'all', text: 'Corra! 3 voltas — passe por todos os checkpoints.' }]);
  d.win = { type: 'goal', target: 1 };
  return d;
}

function ctf() {
  const { d, ent, fill, rule } = builder({ name: 'Capture a Bandeira', icon: '🚩', color: '#ef4444', mode: 'teams', minPlayers: 2, maxPlayers: 8, countdown: 5, onDeath: 'respawn', pvp: true, timeLimit: 600,
    teams: [{ id: 'red', name: 'Vermelho', color: TEAM_COLORS[0] }, { id: 'blue', name: 'Azul', color: TEAM_COLORS[1] }],
    description: 'Dois times. Pegue a bandeira inimiga e leve até a SUA base para marcar. Se o portador morrer, a bandeira volta. Primeiro time a 3 capturas vence.' });
  d.loadout = [{ item: 'sword', count: 1 }, { item: 'bow', count: 1 }, { item: 'arrow', count: 16 }];
  fill(0, -1, 0, 56, 1, 28, 'stone'); fill(0, -1, 0, 8, 1, 28, 'red_terracotta'); fill(48, -1, 0, 8, 1, 28, 'terracotta');   // field + bases
  fill(27, -1, 0, 2, 1, 28, 'cobblestone');
  for (const [x, z, w, h] of [[16, 5, 2, 3], [16, 20, 2, 3], [38, 5, 2, 3], [38, 20, 2, 3], [27, 12, 2, 4]]) fill(x, 0, z, w, h, 2, 'bricks');
  fill(0, 0, -1, 56, 4, 1, 'glass'); fill(0, 0, 28, 56, 4, 1, 'glass'); fill(-1, 0, 0, 1, 4, 28, 'glass'); fill(56, 0, 0, 1, 4, 28, 'glass');
  ent('flag', 2, 0, 12, 3, 4, 3, { team: 'red' }, 'Base vermelha'); ent('flag', 51, 0, 12, 3, 4, 3, { team: 'blue' }, 'Base azul');
  for (const z of [6, 12, 18]) { ent('spawn', 6, 0, z, 1, 1, 1, { team: 'red' }); ent('spawn', 49, 0, z, 1, 1, 1, { team: 'blue' }); }
  ent('killzone', -30, -14, -30, 116, 2, 90);
  rule({ ev: 'gameStart' }, [{ a: 'title', who: 'all', text: 'CAPTURE A BANDEIRA!', sub: 'Leve a bandeira inimiga até a sua base' }]);
  d.win = { type: 'teamScore', target: 3 };
  return d;
}

function hill() {
  const { d, ent, fill, rule } = builder({ name: 'Rei do Morro', icon: '👑', color: '#34d399', mode: 'ffa', minPlayers: 1, maxPlayers: 8, countdown: 4, onDeath: 'respawn', pvp: true, timeLimit: 240,
    description: 'Suba no morro e fique sozinho na zona dourada: você ganha 1 ponto por segundo. Empurre os rivais! Primeiro a 30 pontos vence (ou quem tiver mais quando o tempo acabar).' });
  d.loadout = [{ item: 'sword', count: 1 }];
  fill(0, -1, 0, 32, 1, 32, 'sandstone'); fill(5, 0, 5, 22, 1, 22, 'sandstone'); fill(9, 1, 9, 14, 1, 14, 'sandstone'); fill(12, 2, 12, 8, 1, 8, 'gold_ore');
  ent('zone', 12, 3, 12, 8, 4, 8, { rate: 1, hold: 1 }, 'Zona do Rei');
  for (const [x, z] of [[2, 2], [29, 2], [2, 29], [29, 29]]) ent('spawn', x, 0, z, 1, 1, 1);
  ent('killzone', -30, -14, -30, 92, 2, 92);
  rule({ ev: 'gameStart' }, [{ a: 'title', who: 'all', text: 'SUBA NO MORRO!', sub: 'Fique sozinho na zona dourada' }]);
  d.win = { type: 'score', target: 30 };
  return d;
}

function tag() {
  const { d, ent, fill, rule } = builder({ name: 'Pega-Pega', icon: '🧟', color: '#a3e635', mode: 'teams', minPlayers: 2, maxPlayers: 12, countdown: 5, onDeath: 'respawn', timeLimit: 120, teamStart: 'first',
    teams: [{ id: 'run', name: 'Fugitivos', color: '#22c55e' }, { id: 'inf', name: 'Infectados', color: '#ef4444' }],
    description: 'Um jogador é sorteado como infectado. Quem for tocado por um infectado também se infecta. Fugitivos vencem se sobrar algum quando o tempo acabar; infectados vencem pegando todos. (Precisa de 2+ jogadores.)' });
  fill(0, -1, 0, 36, 1, 36, 'stone'); fill(0, 0, 0, 36, 3, 1, 'glass'); fill(0, 0, 35, 36, 3, 1, 'glass'); fill(0, 0, 0, 1, 3, 36, 'glass'); fill(35, 0, 0, 1, 3, 36, 'glass');
  for (const [x, z] of [[8, 8], [8, 26], [26, 8], [26, 26], [17, 17]]) fill(x, 0, z, 2, 3, 2, 'bricks');
  for (const [x, z] of [[4, 4], [30, 4], [4, 30], [30, 30], [17, 4], [17, 30], [4, 17], [30, 17]]) ent('spawn', x, 0, z, 1, 1, 1, { team: 'run' });
  ent('killzone', -20, -14, -20, 76, 2, 76);
  rule({ ev: 'gameStart' }, [{ a: 'setTeam', who: 'random', team: 'inf' }, { a: 'title', who: 'all', text: 'PEGA-PEGA!', sub: 'Fuja dos infectados' }]);
  rule({ ev: 'playersTouch', team: 'inf', other: 'run' }, [{ a: 'setTeam', who: 'victim', team: 'inf' }, { a: 'addScore', who: 'actor', amount: 1, to: 'player' }, { a: 'message', who: 'all', text: 'Mais um infectado!' }, { a: 'sound', who: 'all', name: 'boom' }]);
  rule({ ev: 'tick', every: 1 }, [{ a: 'endGame', winner: 'team', team: 'inf' }], [{ c: 'teamCount', team: 'run', op: '<=', value: 0 }, { c: 'time', op: '>=', value: 6 }]);
  d.win = { type: 'time', target: 1 };
  return d;
}

function lastStanding() {
  const { d, ent, fill, rule } = builder({ name: 'Último de Pé', icon: '⚔️', color: '#fb923c', mode: 'ffa', minPlayers: 2, maxPlayers: 12, countdown: 5, onDeath: 'eliminate', pvp: true, timeLimit: 300,
    description: 'Arena com cobertura e armas. Você começa com espada e arco (se o sistema de itens estiver ativo). Quem morre é eliminado: sobreviva!' });
  d.loadout = [{ item: 'sword', count: 1 }, { item: 'bow', count: 1 }, { item: 'arrow', count: 24 }];
  fill(0, -1, 0, 34, 1, 34, 'cobblestone'); fill(8, -1, 8, 18, 1, 18, 'stone');
  fill(0, 0, 0, 34, 4, 1, 'bricks'); fill(0, 0, 33, 34, 4, 1, 'bricks'); fill(0, 0, 0, 1, 4, 34, 'bricks'); fill(33, 0, 0, 1, 4, 34, 'bricks');
  for (const [x, z] of [[8, 8], [24, 8], [8, 24], [24, 24], [16, 16]]) fill(x, 0, z, 2, 3, 2, 'stone');
  for (const [x, z] of [[4, 4], [29, 4], [4, 29], [29, 29], [16, 4], [16, 29], [4, 16], [29, 16]]) ent('spawn', x, 0, z, 1, 1, 1);
  ent('itemGiver', 16, 0, 12, 2, 2, 2, { item: 'bow', count: 1, cooldown: 40 }, 'Arco extra'); ent('itemGiver', 16, 0, 20, 2, 2, 2, { item: 'arrow', count: 12, cooldown: 25 }, 'Flechas');
  ent('killzone', -20, -14, -20, 74, 2, 74);
  rule({ ev: 'gameStart' }, [{ a: 'title', who: 'all', text: 'ÚLTIMO DE PÉ', sub: 'Sobreviva!' }]);
  d.win = { type: 'lastAlive', target: 1 };
  return d;
}

/** @type {{id:string, lift:number, make:()=>object}[]} */
const SPECS = [
  { id: 'parkour', lift: 22, make: parkour }, { id: 'spleef', lift: 26, make: spleef }, { id: 'tntrun', lift: 30, make: tntrun }, { id: 'corrida', lift: 20, make: corrida },
  { id: 'ctf', lift: 18, make: ctf }, { id: 'hill', lift: 20, make: hill }, { id: 'tag', lift: 18, make: tag }, { id: 'last', lift: 18, make: lastStanding },
];

/** Validated copies of every template. `lift` = blocks above the player where "build arena here" puts the anchor. */
export function makeTemplates() {
  return SPECS.map((s) => { const { def, warnings } = validateGameDef(s.make()); if (warnings.length) console.warn('[mg] template', s.id, warnings); return { id: s.id, lift: s.lift, def }; });
}
