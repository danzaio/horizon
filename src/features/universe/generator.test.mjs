// node src/features/universe/generator.test.mjs
import assert from 'node:assert/strict';
import { homeAddress, generatePlanet, generateSystem, systemExists, describe, systemsInRegion } from './generator.js';
import { decodeAddress } from './address.js';
import { TYPE_IDS } from './profiles.js';
const counts = {}; let nSys = 0;
for (let i = 0; i < 400; i++) {
  const h = homeAddress('player' + i); assert.equal(h, homeAddress('player' + i));
  const g = generatePlanet(h); assert.ok(g.profile); assert.ok(['verdant', 'lush'].includes(g.type), g.type); counts['home:' + g.type] = (counts['home:' + g.type] || 0) + 1;
  assert.ok(systemExists(g.system.galaxy, g.system.sx, g.system.sy), 'home system must exist on the map');
}
const reg = systemsInRegion(0, 131000, 131000, 131060, 131040); assert.ok(reg.length > 20, 'region has systems: ' + reg.length);
for (const s of reg) { const sys = generateSystem(0, s.sx, s.sy); assert.ok(sys.planets.length >= 3 && sys.planets.length <= 7); nSys++; for (const p of sys.planets) counts[p.type] = (counts[p.type] || 0) + 1; }
assert.deepEqual(JSON.parse(JSON.stringify(generatePlanet(homeAddress('x')).profile)), generatePlanet(homeAddress('x')).profile);
console.log('types:', counts, 'systems', nSys, 'all types present:', TYPE_IDS.every((t) => counts[t] > 0));
console.log(describe(homeAddress('abc')), JSON.stringify(generatePlanet(homeAddress('abc')).profile).length, 'bytes');
