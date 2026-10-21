// node scripts/findvillages.mjs [seed] -> village sites near the origin (plus reef spots are easiest found by flying over warm oceans)
import { ChunkGen } from '../src/world/chunkGen.js';
const seed = +(process.argv[2] || 1337), g = new ChunkGen(seed);
const out = [];
for (let gz = -8; gz <= 8; gz++) for (let gx = -8; gx <= 8; gx++) { const v = g.villageAt(gx, gz); if (v) out.push({ x: v.vx, z: v.vz, y: v.gy, d: Math.round(Math.hypot(v.vx, v.vz)) }); }
out.sort((a, b) => a.d - b.d);
console.log(out.slice(0, 8).map(o => JSON.stringify(o)).join('\n'), '\ntotal', out.length);
