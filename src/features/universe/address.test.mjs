// node src/features/universe/address.test.mjs
import assert from 'node:assert/strict';
import { encodeAddress, decodeAddress, cleanAddress, seedOf, isAddress } from './address.js';

let n = 0, seen = new Set();
let s = 12345; const rnd = (m) => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) % m);
for (let i = 0; i < 20000; i++) {
  const a = { galaxy: rnd(64), sx: rnd(262144), sy: rnd(262144), planet: rnd(8) };
  const e = encodeAddress(a);
  assert.match(e, /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
  assert.deepEqual(decodeAddress(e), a, e);
  assert.deepEqual(decodeAddress(e.toLowerCase().replace(/-/g, ' ')), a);
  assert.ok(Number.isInteger(seedOf(a)) && seedOf(a) > 0);
  seen.add(e); n++;
}
assert.equal(seen.size, n, 'collisions');
for (const a of [{ galaxy: 0, sx: 0, sy: 0, planet: 0 }, { galaxy: 63, sx: 262143, sy: 262143, planet: 7 }]) assert.deepEqual(decodeAddress(encodeAddress(a)), a);
// typos are rejected (single-character change must fail the checksum almost always)
let rejected = 0, tries = 0;
for (let i = 0; i < 2000; i++) {
  const e = encodeAddress({ galaxy: rnd(64), sx: rnd(262144), sy: rnd(262144), planet: rnd(8) }).replace(/-/g, '');
  const k = rnd(12), alpha = '0123456789ABCDEFGHJKMNPQRSTVWXYZ', c = alpha[(alpha.indexOf(e[k]) + 1 + rnd(31)) % 32];
  tries++; if (!isAddress(e.slice(0, k) + c + e.slice(k + 1))) rejected++;
}
assert.ok(rejected / tries > 0.999, `typo rejection ${rejected}/${tries}`);
assert.equal(decodeAddress('hello world!'), null); assert.equal(decodeAddress('1337'), null); assert.equal(cleanAddress('o0il-ABCD-1234'), '0011ABCD1234');
console.log(`address ok: ${n} round-trips, typo rejection ${(100 * rejected / tries).toFixed(2)}%, e.g. ${encodeAddress({ galaxy: 3, sx: 1000, sy: 2000, planet: 2 })}`);
