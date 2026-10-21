// Finds a representative spot for every biome: node scripts/findbiomes.mjs [seed]
import { createTerrain, BIOME } from '../src/world/terrain.js';
const seed = +(process.argv[2] || 1337), t = createTerrain(seed);
const names = Object.fromEntries(Object.entries(BIOME).map(([k, v]) => [v, k]));
const best = {};
for (let z = -6000; z <= 6000; z += 40) for (let x = -6000; x <= 6000; x += 40) {
  const b = t.biomeAt(x, z);
  let ok = 0; for (const [dx, dz] of [[60,0],[-60,0],[0,60],[0,-60],[90,90],[-90,-90]]) if (t.biomeAt(x + dx, z + dz) === b) ok++;
  const d = Math.hypot(x, z);
  const score = ok * 1e5 - d; // fully inside the biome, close to origin
  if (!best[b] || score > best[b].score) best[b] = { score, x, z, y: t.surfaceY(x, z) };
}
for (const [b, v] of Object.entries(best)) console.log(names[b].padEnd(8), JSON.stringify({ x: v.x, y: v.y, z: v.z }));
