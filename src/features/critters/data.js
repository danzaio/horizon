// Critters ("bichinhos"): types, moves, species, stats. Pure data + formulas, no DOM / THREE, so the battle engine runs (and is tested) in node.
export const TYPES = [
  { id: 'fogo', n: 'Fogo', c: '#f97316', i: '🔥' }, { id: 'agua', n: 'Água', c: '#38bdf8', i: '💧' }, { id: 'planta', n: 'Planta', c: '#4ade80', i: '🌿' }, { id: 'eletrico', n: 'Elétrico', c: '#facc15', i: '⚡' },
  { id: 'terra', n: 'Terra', c: '#b45309', i: '🪨' }, { id: 'gelo', n: 'Gelo', c: '#a5f3fc', i: '❄️' }, { id: 'sombra', n: 'Sombra', c: '#a78bfa', i: '🌑' }, { id: 'vento', n: 'Vento', c: '#cbd5e1', i: '🌪' },
];
export const NEUTRAL = 8;                                  // type index of "normal" moves (no STAB, neutral against everything)
// SE[attacker] = defenders it hits for x2 · RES[attacker] = defenders that resist it (x0.5)
const SE = { 0: [2, 5], 1: [0, 4], 2: [1, 4], 3: [1, 7], 4: [0, 3], 5: [2, 7, 4], 6: [7, 3], 7: [2, 6] };
const RES = { 0: [1, 4, 0], 1: [2, 1], 2: [0, 5, 2, 7], 3: [3, 4, 2], 4: [2, 7], 5: [0, 1, 5], 6: [6, 4], 7: [3, 4] };
export function effectiveness(att, defTypes) {
  if (att === NEUTRAL) return 1; let m = 1;
  for (const d of defTypes) { if (SE[att] && SE[att].includes(d)) m *= 2; else if (RES[att] && RES[att].includes(d)) m *= 0.5; }
  return m;
}

// ---- moves: [id, name, type, power, accuracy, kind] kind: dmg · heal · buffAtk · buffDef · buffSpd · protect
const M = [
  ['investida', 'Investida', NEUTRAL, 40, 100, 'dmg'], ['pancada', 'Pancada', NEUTRAL, 65, 95, 'dmg'], ['golpe', 'Golpe Final', NEUTRAL, 85, 85, 'dmg'],
  ['rugido', 'Rugido', NEUTRAL, 0, 100, 'buffAtk'], ['escudo', 'Escudo', NEUTRAL, 0, 100, 'buffDef'], ['agil', 'Agilidade', NEUTRAL, 0, 100, 'buffSpd'], ['guarda', 'Guarda', NEUTRAL, 0, 100, 'protect'], ['descanso', 'Descanso', NEUTRAL, 0, 100, 'heal'],
  ['brasa', 'Brasa', 0, 40, 100, 'dmg'], ['labareda', 'Labareda', 0, 65, 95, 'dmg'], ['inferno', 'Inferno', 0, 90, 88, 'dmg'],
  ['jato', 'Jato d’água', 1, 40, 100, 'dmg'], ['onda', 'Onda', 1, 65, 95, 'dmg'], ['maremoto', 'Maremoto', 1, 90, 88, 'dmg'],
  ['folhada', 'Folhada', 2, 40, 100, 'dmg'], ['cipo', 'Chicote de Cipó', 2, 65, 95, 'dmg'], ['tempfolhas', 'Tempestade de Folhas', 2, 90, 88, 'dmg'],
  ['faisca', 'Faísca', 3, 40, 100, 'dmg'], ['choque', 'Choque', 3, 65, 95, 'dmg'], ['trovao', 'Trovão', 3, 90, 88, 'dmg'],
  ['pedrada', 'Pedrada', 4, 40, 100, 'dmg'], ['terremoto', 'Terremoto', 4, 65, 95, 'dmg'], ['avalanche', 'Avalanche', 4, 90, 88, 'dmg'],
  ['geada', 'Geada', 5, 40, 100, 'dmg'], ['raiogelo', 'Raio de Gelo', 5, 65, 95, 'dmg'], ['nevasca', 'Nevasca', 5, 90, 88, 'dmg'],
  ['arranhao', 'Arranhão Sombrio', 6, 40, 100, 'dmg'], ['bolasombra', 'Bola Sombria', 6, 65, 95, 'dmg'], ['eclipse', 'Eclipse', 6, 90, 88, 'dmg'],
  ['rajada', 'Rajada', 7, 40, 100, 'dmg'], ['ciclone', 'Ciclone', 7, 65, 95, 'dmg'], ['furacao', 'Furacão', 7, 90, 88, 'dmg'],
];
export const MOVES = {}; for (const [id, n, t, p, a, k] of M) MOVES[id] = { id, n, t, p, a, k };
const TIER = [['brasa', 'labareda', 'inferno'], ['jato', 'onda', 'maremoto'], ['folhada', 'cipo', 'tempfolhas'], ['faisca', 'choque', 'trovao'], ['pedrada', 'terremoto', 'avalanche'], ['geada', 'raiogelo', 'nevasca'], ['arranhao', 'bolasombra', 'eclipse'], ['rajada', 'ciclone', 'furacao']];

// ---- species. plan: quad · biped · flier · blob · serpent. c = [main, accent] colours; feat = visual feature id
// line = [stage1, stage2, stage3] names; evo = levels at which stage 1 -> 2 -> 3
const LINES = [
  { names: ['Fagulho', 'Brasilisco', 'Pirodrako'], types: [0], plan: 'quad', c: [[236, 120, 60], [255, 210, 80]], feat: 'flame', hab: ['PLAINS', 'SAVANNA', 'DESERT', 'BADLANDS'], evo: [16, 36], bias: [1, 1.1, 0.9, 1.05] },
  { names: ['Gotinho', 'Marezal', 'Oceanox'], types: [1], plan: 'blob', c: [[80, 160, 235], [200, 235, 255]], feat: 'fin', hab: ['OCEAN', 'BEACH', 'RIVER', 'SWAMP'], evo: [16, 36], bias: [1.1, 0.95, 1.05, 0.95] },
  { names: ['Folhito', 'Selvagil', 'Florestrix'], types: [2], plan: 'quad', c: [[90, 190, 90], [240, 120, 160]], feat: 'leaf', hab: ['FOREST', 'BIRCH', 'CHERRY', 'PLAINS'], evo: [16, 36], bias: [1.05, 0.95, 1.1, 0.95] },
  { names: ['Faisquinha', 'Trovinho', 'Relampex'], types: [3], plan: 'biped', c: [[250, 214, 70], [60, 50, 40]], feat: 'bolt', hab: ['PLAINS', 'SAVANNA', 'STONY', 'PEAKS'], evo: [16, 36], bias: [0.9, 1.05, 0.9, 1.25] },
  { names: ['Pedrinho', 'Rochedo', 'Montanox'], types: [4], plan: 'quad', c: [[150, 130, 110], [200, 190, 170]], feat: 'shell', hab: ['STONY', 'PEAKS', 'BADLANDS', 'DESERT'], evo: [16, 36], bias: [1.1, 1.0, 1.25, 0.7] },
  { names: ['Gelinho', 'Cristalino', 'Glaciax'], types: [5], plan: 'biped', c: [[170, 225, 245], [255, 255, 255]], feat: 'crystal', hab: ['SNOWY', 'FROZEN', 'TAIGA', 'PEAKS'], evo: [16, 36], bias: [1, 1.0, 1.0, 1.0] },
  { names: ['Sombrinha', 'Noctis', 'Umbrax'], types: [6], plan: 'flier', c: [[80, 60, 120], [230, 80, 120]], feat: 'ears', hab: ['SWAMP', 'FOREST', 'TAIGA', 'STONY'], evo: [18, 38], bias: [0.95, 1.1, 0.9, 1.15] },
  { names: ['Ventinho', 'Brisão', 'Tempestro'], types: [7], plan: 'flier', c: [[190, 215, 235], [255, 255, 255]], feat: 'wings', hab: ['PEAKS', 'SAVANNA', 'BEACH', 'PLAINS'], evo: [18, 38], bias: [0.9, 1.0, 0.85, 1.3] },
  { names: ['Cogulho', 'Cogumago', 'Cogumestre'], types: [2, 6], plan: 'blob', c: [[200, 70, 70], [250, 240, 220]], feat: 'cap', hab: ['FOREST', 'SWAMP', 'BIRCH'], evo: [14, 34], bias: [1.1, 0.95, 1.0, 0.85] },
  { names: ['Besourito', 'Escaravelho', 'Titanouro'], types: [4, 2], plan: 'quad', c: [[60, 110, 70], [210, 190, 80]], feat: 'horn', hab: ['FOREST', 'PLAINS', 'SAVANNA'], evo: [14, 34], bias: [1.0, 1.15, 1.1, 0.8] },
  { names: ['Peixito', 'Barbatanax', 'Leviatã'], types: [1, 5], plan: 'serpent', c: [[60, 120, 200], [250, 200, 120]], feat: 'fin', hab: ['OCEAN', 'RIVER', 'FROZEN'], evo: [16, 36], bias: [1.05, 1.05, 0.95, 1.0] },
  { names: ['Chamito', 'Cinzão', 'Vulcanix'], types: [0, 4], plan: 'biped', c: [[110, 60, 50], [255, 140, 40]], feat: 'horn', hab: ['BADLANDS', 'DESERT', 'STONY'], evo: [20, 40], bias: [1.1, 1.15, 1.05, 0.75] },
];
export const SPECIES = [];
LINES.forEach((ln, li) => {
  for (let st = 0; st < 3; st++) {
    const t = [40, 62, 86][st], b = ln.bias;
    SPECIES.push({ id: SPECIES.length, name: ln.names[st], types: ln.types, plan: ln.plan, c: ln.c, feat: ln.feat, stage: st, line: li, hab: ln.hab, evoAt: st < 2 ? ln.evo[st] : 0, next: st < 2 ? SPECIES.length + 1 : -1,
      base: [Math.round(t * 1.05 * b[0]), Math.round(t * b[1]), Math.round(t * b[2]), Math.round(t * 1.0 * b[3])], rate: [0.5, 0.28, 0.12][st], legend: false });
  }
});
for (const [n, types, c, feat, plan, hab] of [['Solaris', [0, 7], [[255, 190, 60], [255, 250, 200]], 'wings', 'flier', ['DESERT', 'SAVANNA', 'BADLANDS']], ['Lunareth', [6, 5], [[60, 50, 110], [180, 220, 255]], 'crystal', 'flier', ['FROZEN', 'SNOWY', 'TAIGA']]]) SPECIES.push({ id: SPECIES.length, name: n, types, plan, c, feat, stage: 2, line: -1, hab, evoAt: 0, next: -1, base: [100, 105, 90, 95], rate: 0.03, legend: true });
export const speciesById = (i) => SPECIES[i] || SPECIES[0];

/** moves a species knows at a given level (the 4 most recent) */
export function learnset(sp) {
  const w = (t, k) => TIER[t][k], L = [{ l: 1, m: 'investida' }, { l: 1, m: w(sp.types[0], 0) }, { l: 5, m: 'rugido' }, { l: 10, m: w(sp.types[0], 1) }, { l: 14, m: 'escudo' }, { l: 20, m: 'guarda' }, { l: 26, m: w(sp.types[0], 2) }, { l: 30, m: 'descanso' }, { l: 34, m: 'golpe' }];
  if (sp.types[1] !== undefined) L.push({ l: 8, m: w(sp.types[1], 0) }, { l: 22, m: w(sp.types[1], 1) }, { l: 36, m: w(sp.types[1], 2) });
  if (sp.legend) L.push({ l: 40, m: 'agil' });
  return L.sort((a, b) => a.l - b.l);
}
export function moveset(spId, level) { const ls = learnset(speciesById(spId)).filter((x) => x.l <= level).map((x) => x.m); const u = [...new Set(ls)]; return u.slice(-4); }

export const MAX_LEVEL = 60;
export const xpNeed = (l) => Math.floor(6 * l * l);
export function stats(spId, level) {
  const b = speciesById(spId).base, f = (v) => Math.floor(v * 2 * level / 100) + 5;
  return { hp: Math.floor(b[0] * 2 * level / 100) + level + 10, atk: f(b[1]), def: f(b[2]), spd: f(b[3]) };
}
/** a fresh creature record (what gets saved / sent over the network as a summary) */
export function makeCreature(spId, level, id) { const st = stats(spId, level); return { id: id || Math.random().toString(36).slice(2, 9), s: spId, l: level, x: 0, h: st.hp, m: moveset(spId, level) }; }
export const maxHp = (c) => stats(c.s, c.l).hp;
export function sanitizeCreature(c) {
  if (!c || typeof c !== 'object') return null;
  const s = Math.max(0, Math.min(SPECIES.length - 1, c.s | 0)), l = Math.max(1, Math.min(MAX_LEVEL, c.l | 0)), mx = stats(s, l).hp;
  return { id: String(c.id || '').slice(0, 10) || 'x', s, l, x: Math.max(0, c.x | 0), h: Math.max(0, Math.min(mx, c.h | 0)), m: moveset(s, l) };
}
/** capture chance 0..1 */
export function captureChance(sp, hpFrac, level, mult) { const base = sp.rate * (1.5 - hpFrac) * (1 + (60 - Math.min(level, 60)) / 80); return Math.max(0.02, Math.min(0.97, base * mult)); }
export function xpYield(enemySpId, enemyLevel) { const s = speciesById(enemySpId); return Math.floor(enemyLevel * (28 + 22 * s.stage + (s.legend ? 60 : 0)) / 3); }
