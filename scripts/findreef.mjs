// node scripts/findreef.mjs [seed] -> nearest warm-ocean reef patch and kelp forest
import { createTerrain, BIOME } from '../src/world/terrain.js';
const seed = +(process.argv[2] || 1337), T = createTerrain(seed), info = {};
let reef = null, kelp = null;
for (let z = -3000; z <= 3000; z += 16) for (let x = -3000; x <= 3000; x += 16) {
  T.columnInfo(x, z, 9, info);
  if (info.biome !== BIOME.OCEAN || info.h > 58 || info.h < 40) continue;
  const n = T.noise2.n2(x * 0.05 + 77, z * 0.05 - 31), d = Math.hypot(x, z);
  if (info.temp > 0.45 && n > 0.3 && (!reef || d < reef.d)) reef = { x, z, y: Math.floor(info.h), d: Math.round(d), temp: +info.temp.toFixed(2) };
  const k = T.noise2.n2(x * 0.03 - 9, z * 0.03 + 40);
  if (info.temp < 0.45 && k > 0.2 && info.h < 54 && (!kelp || d < kelp.d)) kelp = { x, z, y: Math.floor(info.h), d: Math.round(d), temp: +info.temp.toFixed(2) };
}
console.log('reef', JSON.stringify(reef)); console.log('kelp', JSON.stringify(kelp));
