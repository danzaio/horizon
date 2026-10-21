# HORIZON — Planetas (agente U)

Every planet is a full infinite world with its **own look and rules**, addressable by a short code. Code lives in `src/features/universe/`.

## 1. Endereços (`address.js`)
`XXXX-XXXX-XXXX` = 12 chars Crockford base32 (`0-9 A-Z` without `I L O U`; `O→0`, `I/L→1` accepted, case/dashes/spaces ignored) = 60 bits:
`payload 45 bits` (galaxy 6 · sx 18 · sy 18 · planet 3, scrambled by a bijective mixer so neighbours look unrelated) + `15-bit checksum` (typos and random text are rejected).
`sx,sy` is the map cell of the star system, so an address is also a position on the galaxy map. API: `encodeAddress({galaxy,sx,sy,planet})`, `decodeAddress(str) → obj|null`, `normalizeAddress`, `isAddress`, `seedOf(addr)` (30-bit world seed). Test: `node src/features/universe/address.test.mjs`.

## 2. Universo (`generator.js`)
* `systemExists(galaxy,sx,sy)`: one candidate system per cell, density follows soft spiral arms around the galactic centre.
* `generateSystem(g,sx,sy)`: star (M K G F A B giant-red white-dwarf, colour, luminosity, 16 % binary), 3–7 planets with growing orbits, a pt-BR/sci-fi name per system and planet (syllable tables), planet **type** by heat band (`luminosity / orbit²`): inferno→volcanic/desert/barren … temperate→verdant/lush/ocean/alien … cold→frozen/barren. The planet nearest to the habitable zone is always verdant/lush/ocean/alien.
* `generatePlanet(addr) → {address, seed, system, index, planet, name, type, profile}`; `homeAddress(identityId)`: deterministic per player, always a verdant or lush planet of an existing star near the galactic centre (so everybody starts in the same kind of friendly world). `profileFor`, `describe`, `systemsInRegion` (lazy, used by the map).
* The profile is a pure function of the address (per-planet random variation comes from `seedOf(address)`).

## 3. PlanetProfile (`profiles.js`) — JSON, ~600 bytes, `v:1`
```jsonc
{ "v":1, "type":"alien",
  "terrain": { "heightBias":0.05,       // shifts continentalness: -0.5 oceans … +0.3 continents
               "mountainScale":1.2, "hillScale":1.4, "riverScale":1, "lakeScale":1.2, "caveScale":1.3, "treeMul":1.6 },   // 0 disables rivers/lakes/caves/trees
  "climate": { "tempBias":0.1, "humBias":0.4, "spread":0.4, "snowLine":0 },   // added to the climate noise (spread scales the noise: small = homogeneous planet); snowLine raises the snow line
  "palette": { "grass":[150,70,214], "foliage":[36,206,190], "water":[92,62,214] },   // sRGB bytes: PLAINS tint, other biomes keep their relative variation
  "trees": "oak",                       // optional: every tree is an oak so `foliage` tints the whole canopy
  "ground": { "top":"GRAVEL", "fill":"STONE", "lod":[88,84,84] },   // optional: replaces grass as ground cover (+ LOD colour)
  "sand": "red" | "gravel",             // optional: desert/beach surface
  "sky": { "zenith":[r,g,b], "horizon":[r,g,b], "dusk":[r,g,b],     // display-linear floats, same space as TimeOfDay
           "sun":[r,g,b], "sunCount":1|2, "sun2":[r,g,b], "sunScale":1,
           "moons":[{"size":2.2,"color":[r,g,b]}],                // up to 3, size relative to the stock moon
           "stars":1.6, "aurora":1.6, "cloud":0.4, "fog":1 },     // star density, aurora strength, cloud cover 0..1, fog density multiplier
  "gravity":0.7, "dayLength":30,         // g and minutes per day (stock = 20)
  "villages":0,                          // 0..1 multiplier of village chance
  "seaGlow":1 }                          // emissive sea (volcanic: magma)
```
`profile === null` ⇒ the legacy world, **bit-identical** (checked: voxels, chunk meshes, LOD tiles hash-equal against a pre-planet copy of the engine). `sanitizeProfile(p)` clamps anything that arrives from outside (network, saves).

### Types
| id | look | rules |
|---|---|---|
| verdant | today's world, mild variation | 0.95–1.05 g |
| lush | saturated jungle, giant oaks, 2–3× trees, big rivers | humid, fog 1.2–1.6 |
| desert | dunes, mesas, hazy pale sky, big sun, (red sand 50 %) | no rivers, no snow, 0.85–1 g |
| frozen | taiga/snow/ice sheets, blue palette, strong aurora, many stars | cold, 0.8–0.95 g |
| volcanic | dark gravel rock, red sky, **glowing magma sea**, no trees, dense fog | 1.05–1.25 g, caves ×1.5 |
| ocean | water world, few islands (heightBias −0.5) | no rivers/lakes |
| alien | violet grass, teal foliage, **two suns, two moons**, aurora, many stars | 0.55–0.8 g, long days |
| barren | grey gravel, no trees, no clouds, black sky with stars **and a huge moon in daylight** | 0.4–0.6 g, 30–40 min days |

## 4. Engine plumbing
* `createTerrain(seed, profile)` (`terrain.js`): neutral values (0 / 1) leave every expression bit-identical; exports `makeTintTable(profile)` — a **per-profile copy** of the biome tint table (the global `TINT_TABLE` is never mutated); `terrain.tint` is what `Mesher` (chunks) and `LodMesher` read, so chunk and LOD colours always match.
* `ChunkGen(seed, profile)`: ground/sand overrides, oak-only canopies, tree/cave/village multipliers. `LodMesher` mirrors them (leaf colours from the foliage tint, ground/sand colours, tree density).
* The profile is posted with every worker job (`World` → `WorkerPool` → `chunk.worker.js`); the worker rebuilds its generator only when seed or profile change.
* Renderer: `gr.setPlanetLook(profile)` → `TimeOfDay.setLook` (sky/dusk/glow/key/ambient colours, second-sun and moon directions), sky shader uniforms (`uSun2`, `uSunCol`, `uSkyL`, `uMoons[3]`, `uAurA/B`, `uStarDay`), fog multiplier, cloud cover, day length (`time.speed`), water tint clamp (`uWTClamp`) and sea glow (`uSeaGlow`). `SKY_CHEAP` (potato) path untouched; second sun is `#ifndef SKY_CHEAP`.
* Gravity: `ctx.player.gravityScale = profile.gravity` (G's Player honours it).
* Magma seas (`seaGlow`): the water shader mixes in drifting crust plates over incandescent cracks (`uSeaGlow`); swimming in it burns (`ctx.health.damage`, if G's health exists).
* `World` validates the profile with `src/world/profile.js::sanitizeProfile` (it may arrive from a host over the network) and registers it with `terrain.setDefaultProfile`, so `createTerrain(seed)` calls made by `main.js` (weather / mob biome lookups) see the same planet.

## 5. Feature (`index.js`, order 10) — `ctx.universe`
```js
ctx.universe = { planet, homeAddress(id), profileFor(addr), describe(addr), openMap(), travel(addr), visited[] }
```
`resolvePlanet`: `?planet=ADDR` always wins; an address typed in the seed box visits that planet; numbers/text keep the legacy world (`profile:null`); `?seed=N` keeps the legacy world; empty seed (menu, not `?autostart`) ⇒ **home planet** `homeAddress(identity.id)`, `domeMode:'closed'`. `?autostart=1` without `?planet` stays legacy so old test scripts are unchanged. A player who already has a saved legacy "Seu planeta" (seed derived from the player id) keeps resuming it; new players get a real home planet. Typed numbers/text always open the legacy world of that seed.
Events: `universe:ready {address,type,name}`, `universe:travel {address}`. Persistence: `localStorage horizon.universe.visited.v1`, `horizon.dome.<seed>` (dome centre).
**Galaxy map** (key `J`, toolbar 🪐): canvas-2D star chart (parallax starfield, grid, lazily generated systems around the player, pan/zoom, hover names, galaxies ◀ ▶, go-to-address box, whole-galaxy minimap with the spiral arms — click to jump), system inspector with procedurally drawn planet icons (`planetIcon.js`: shaded sphere in the palette, clouds, ice caps, magma cracks, rings, moons), type/gravity/day/sky summary, **Viajar** (hyperspace transition ≈1.2 s, saves, reloads into `?planet=ADDR` and auto-starts), **Copiar endereço**. Travel is disabled with a toast unless `ctx.role === 'solo'`.
**Dome** (`dome.js`): hemisphere shell (radius 48) around the home spawn, hex-grid fresnel shader with travelling pulses; modes from `ctx.dome.mode` / `dome:change` (closed shimmer, open = faint shell with a doorway, invite = amber); one draw call, off on potato (`skyDetail 0`) and when you are > 190 blocks away.

## 6. Tests
`node src/features/universe/address.test.mjs` · `node src/features/universe/generator.test.mjs`. Visual: screenshot script with `?planet=ADDR` (see agent U scratchpad `pshots.mjs`).
