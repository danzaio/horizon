// Module worker: chunk generation + meshing and LOD tile building. Transferables only.
import { ChunkGen } from './chunkGen.js';
import { Mesher } from './mesher.js';
import { LodMesher } from './lodMesher.js';

let seed = null, gen = null, mesher = null, lod = null, profKey = '';
/** planet profile arrives as JSON (null = legacy world); the generator is rebuilt only when seed or profile change */
function ensure(s, profile) {
  const pk = profile ? JSON.stringify(profile) : '';
  if (s === seed && pk === profKey) return;
  seed = s; profKey = pk; gen = new ChunkGen(s, profile || null); mesher = mesher || new Mesher(); lod = new LodMesher(gen.terrain);
}
function collect(part, list) {
  if (!part) return;
  for (const k in part) { const v = part[k]; if (v && v.buffer instanceof ArrayBuffer) list.push(v.buffer); }
}

self.onmessage = (e) => {
  const m = e.data;
  try { handle(m); } catch (err) {
    self.postMessage({ type: 'error', kind: m.type, id: m.id, cx: m.cx, cz: m.cz, L: m.L, tx: m.tx, tz: m.tz, msg: String(err && err.stack || err) });
  }
};

function handle(m) {
  ensure(m.seed, m.profile);
  const t0 = performance.now();
  const tr = [];
  if (m.type === 'chunk') {
    gen.generate(m.cx, m.cz, m.edits || null);
    const t1 = performance.now();
    let res = { solid: null, water: null };
    if (!m.skipMesh) res = mesher.mesh(gen);
    const t2 = performance.now();
    const out = { type: 'chunk', id: m.id, cx: m.cx, cz: m.cz, ver: m.ver, skipMesh: !!m.skipMesh, urgent: !!m.urgent, solid: res.solid, water: res.water, heights: gen.heights(), genMs: t1 - t0, meshMs: t2 - t1, ms: t2 - t0 };
    if (m.wantVoxels) out.voxels = gen.copyInterior();
    collect(res.solid, tr); collect(res.water, tr); tr.push(out.heights.buffer); if (out.voxels) tr.push(out.voxels.buffer);
    self.postMessage(out, tr);
  } else if (m.type === 'lod') {
    const res = lod.build(m.L, m.tx, m.tz);
    const out = { type: 'lod', id: m.id, L: m.L, tx: m.tx, tz: m.tz, solid: res.solid, water: res.water, ms: performance.now() - t0 };
    collect(res.solid, tr); collect(res.water, tr);
    self.postMessage(out, tr);
  }
}
