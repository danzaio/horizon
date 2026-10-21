# HORIZON — Architecture Contract (READ FULLY BEFORE WRITING CODE)

Goal: a **Minecraft-like voxel world in Three.js (r0.186.1, WebGL2)** that is *gorgeous* (custom shaders, atmosphere, water, clouds, shadows, post-fx)
with an **effectively infinite view distance** (Distant-Horizons-style LOD out to thousands of blocks, fog fades into sky so the edge is never seen)
and **top-notch performance** (must run on a potato: integrated GPUs, old phones; adaptive quality).
Zero external assets: all textures procedural (canvas/typed arrays), all audio procedural (WebAudio). Vanilla JS ES modules (no TypeScript). Vite.

Three agents work **in parallel** in `/home/user/horizon`. Each OWNS a folder. Do NOT edit files you don't own (except to read).
If you need something changed in someone else's area or in `src/shared/*` / this contract → implement a local workaround and mention it in your final report.

| Agent | Owns | Delivers |
|---|---|---|
| WORLD  | `src/world/**` | terrain gen, greedy mesher, LOD tiles, chunk/LOD streaming, workers, `World` class |
| RENDER | `src/render/**` | procedural textures, ALL shaders/materials, sky/clouds/sun/moon/stars, day-night, shadows, post-fx, `GameRenderer` |
| GAME   | `src/game/**`, `src/ui/**`, `src/main.js`, `index.html`, `README.md` | player, collision, interaction, HUD/menus, debug overlay, auto-quality, audio, particles, touch, glue |
| (orchestrator) | `src/shared/**`, `docs/**`, `scripts/**`, `package.json`, `vite.config.js` | contract, block registry, presets |

Shared (read-only for you): `src/shared/constants.js`, `src/shared/blocks.js`, `src/shared/quality.js`. Read them first — they are short.

## 0. Rules
* Time-box: **hard stop 09:28 UTC** (`date -u`). Deliver a WORKING core early (≈09:15), then polish. A working simple thing beats a broken ambitious one.
* Performance is a feature: no per-frame allocations in hot paths, typed arrays, time-budgeted work per frame, workers for generation/meshing.
* Test visually with the helper: `node scripts/shot.mjs <url> <out.png> [--wait=ms] [--ready="js expr"] [--eval="js"] [--json="js expr"]` (headless Chromium, software WebGL2, 1280x720).
  Start the dev server yourself on YOUR OWN port: `cd /home/user/horizon && npx vite --port <p> &` (WORLD 5201, RENDER 5202, GAME 5203). Screenshots go to the scratchpad dir `/tmp/claude-0/-home-user/909ae463-6711-55a8-ad26-4029f138c696/scratchpad/` (use `Read` on the png to LOOK at it). SwiftShader is slow (~1-5 fps) — judge visuals, not fps; judge perf by counting work (draw calls, triangles, ms per job measured with performance.now() in workers).
  Console lines starting with `[HZ]` are always printed by the helper; errors/warnings too.
* Log with `console.log('[HZ] ...')` sparingly. Never leave a blocking loop > 8 ms on the main thread.
* Use Vite worker syntax: `new Worker(new URL('./chunk.worker.js', import.meta.url), { type: 'module' })`.
* Code quality: small modules, JSDoc on public API, no dead code. Keep each file < ~900 lines.

## 1. Coordinates & data
* Y up. 1 unit = 1 block. Chunk = 32×32 columns × 192 high. Chunk (cx,cz) covers world x∈[cx*32, cx*32+32), z likewise. World y∈[0,192). Sea level 62.
* Voxels: `Uint8Array(CHUNK_VOLUME)`, index `vIndex(x,y,z) = x + (z<<5) + (y<<10)` (chunk-local x,z∈[0,32), y∈[0,192)). Block ids from `src/shared/blocks.js` (`B.*`). `B.UNLOADED(255)` = column not loaded (solid+opaque for collision).
* The world is **deterministic**: `terrain(seed)` pure functions + sparse **player-edit overlay** (Map keyed by chunk → list of [x,y,z,id]). Workers regenerate terrain on demand and apply the overlay; the main thread keeps interior voxels only for chunks within a small "data radius" (≥3 chunks) for collision/raycast/edit.
* Face ids: 0:+X 1:-X 2:+Y 3:-Y 4:+Z 5:-Z (6 = cross-plant). Tile layer for (block,face) = `TILE_FACE[id*6+face]`.
* Large coordinates must stay precise: meshes are chunk-local with `mesh.position = (cx*32, 0, cz*32)`; three computes modelView in float64 so this is fine. In shaders NEVER use raw absolute world positions in float32 for noise/waves beyond ~1e4: use camera-relative pos + `mod()`-wrapped world offset passed as uniform (`uWorldOffset` = camera pos mod 4096, etc.).

## 2. Mesh formats (WORLD produces, RENDER consumes) — EXACT
### 2a. Voxel chunk meshes (LOD level 0) — `THREE.BufferGeometry`, two meshes per chunk max: `solid` (opaque+cutout+cross-plants+lava/ice) and `water`
Attributes (all interleaving is optional; separate typed arrays are fine):
| name | type | itemSize | normalized | meaning |
|---|---|---|---|---|
| `aPos`  | Uint16Array | 4 | no | x,y,z in **1/16 block** units, chunk-local (0..512, 0..3072, 0..512); **w = texture-array layer** (tile index). |
| `aMeta` | Uint8Array  | 4 | no | `x` = face (bits0-2) \| AO<<3 (bits3-4, 0 dark..3 bright) \| META_SWAY(32) \| META_CUTOUT(64) \| META_EMISSIVE(128). `y` = u, `z` = v texture coords **in whole blocks** (0..32; greedy quads repeat the tile via REPEAT wrap; for cross-plants/water corners use 0/1). `w` = light: sky<<4 \| block (each 0..15). |
| `aTint` | Uint8Array  | 4 | **yes** | rgb = biome tint multiplier (255,255,255 = none) applied to texture (for opaque tiles only where tile alpha = tint mask; for META_CUTOUT tiles to the whole tile). **a** = for water vertices: water column depth 0..1 (= min(depth,16)/16, used for shallow→deep color/foam); otherwise 1. |
| index | Uint16Array or Uint32Array | | | triangles CCW seen from outside. Quad diagonal must be flipped by AO to avoid anisotropy. |
Set `geometry.boundingBox/boundingSphere` explicitly (tight, from real min/max y) — chunk meshes use `frustumCulled=true`, `matrixAutoUpdate=false` (call `updateMatrix()` once).
Cross-plants: 2 diagonal quads (both sides, face=6), height 1, `META_SWAY` + `META_CUTOUT`.
Water: faces only where the neighbour isn't water and isn't opaque; top surface at y+WATER_TOP when the block above is not water; `aTint.a` as above; AO=3.
Light: `sky` = sky exposure 0..15 (cheap column-based: full light above the column's highest opaque block, then fades ~1 level per block below it, smoothed with neighbours; 15 for air above terrain); `block` = emissive blocks (glowstone, lava) falloff within ~8 blocks (can be coarse). No full flood-fill required.
Worker → main result message for a chunk: `{ type:'chunk', cx, cz, solid:{aPos,aMeta,aTint,index,minY,maxY,tris}|null, water:{...}|null, voxels?: Uint8Array (interior copy, only if requested) , heights: Uint8Array(1024) top-solid-y per column, ms }` with all arrays in the transfer list.

### 2b. LOD tiles (levels 1..MAX_LOD) — `THREE.BufferGeometry`, per tile: `lodSolid` and `lodWater`
Tile (L,tx,tz): edge = `32 * 2^L` blocks, origin = (tx*edge, tz*edge), 32×32 cells of `2^L` blocks. Sampled from the **same terrain functions** as chunks (fewer noise octaves at coarse levels = cheap). Column-mesh ("stepped voxel columns"): one top quad per cell (merge runs of equal-height/color cells), vertical side quads where a neighbouring cell is lower, and **skirts** on the tile perimeter (extend down ≥ 2*2^L) to hide cracks between different levels. Bias LOD heights slightly down (≈ 0.25*2^L, max ~6) so they never poke through finer geometry. Water cells: bed in `lodSolid`, flat water quad at `SEA_LEVEL+WATER_TOP` in `lodWater`.
| name | type | itemSize | normalized | meaning |
|---|---|---|---|---|
| `position` | Float32Array | 3 | no | tile-local (mesh.position = tile origin x, 0, z) |
| `aColor` | Uint8Array | 4 | **yes** | rgb = final albedo (sRGB, includes biome tint, snow, sand, canopy green, rock...), a = baked shade/AO 0..1 (solid) or water depth 0..1 (water: min(depth,64)/64) |
| `aMeta` | Uint8Array | 4 | no | x = face 0..5; y = LODF_* flags (CANOPY=1 SNOW=2 CLIFF=4 SAND=8 WATER=16); z = per-cell hash 0..255 (pixel-detail seed); w = level L |
| index | Uint16/Uint32 | | | CCW |
Forests: cells flagged CANOPY get raised by ~tree height and leaf-colored with probability by density, so forests read from far away.

## 3. Materials (RENDER produces, WORLD consumes)
`gameRenderer.materials = { solid, water, lodSolid, lodWater }` — `THREE.ShaderMaterial`s. WORLD simply does `new THREE.Mesh(geometry, materials.X)`; it never touches uniforms/shader code. Materials share global uniform objects, updated by `GameRenderer.update()`.
* `solid`: decodes the chunk format above, texture-array (`sampler2DArray`, procedural 16×16 tiles, NEAREST mag + mipmapped min, anisotropic if available), tint/mask logic, face shading, AO, sky/block light, sun diffuse, optional shadow-map lookup (define-driven), wind sway, fog = aerial perspective matching the sky (height + distance, sun-scattering tint), cutout discard.
* `water`: transparent, depthWrite=false (or true when waterFX==0), procedural animated normals, Fresnel sky reflection (analytic sky function), sun glint, depth-based color/alpha/foam from `aTint.a`, fog; renderOrder after solid.
* `lodSolid` / `lodWater`: decode the LOD format, per-pixel procedural detail (voxel-ish block pattern fading with distance, rock strata on CLIFF, leaf noise on CANOPY), same lighting/fog. Must visually match chunk terrain at the LOD0↔LOD1 boundary (same tint math, same fog).
* Uniforms are RENDER-internal. Fog must use the same params for all four materials. Far plane ≥ 20000.

## 4. APIs

### 4a. `src/render/GameRenderer.js` — `export class GameRenderer` (RENDER)
```js
new GameRenderer({ canvas, quality /* preset name or preset obj */ })
.renderer   // THREE.WebGLRenderer (antialias:false, powerPreference:'high-performance', stencil:false, alpha:false)
.scene      // THREE.Scene (sky etc. already inside)
.camera     // THREE.PerspectiveCamera (near 0.3, far 24000), game moves it
.materials  // see §3
.time       // TimeOfDay: .hours (0-24, 6=sunrise 12=noon 18=sunset), .speed (game hours per real second, default 0.02 ≈ 20min day), .paused, .sunDir (Vector3, read-only), .moonDir, .isNight
.setQuality(nameOrPreset)      // applies shadows/post/clouds/waterFX/sky/renderScale/wind live (rebuild targets lazily)
.setRenderScale(s)             // 0.3..1 multiplier on min(devicePixelRatio,2); AutoQuality calls this
.setUnderwater(bool)           // underwater fog/tint/caustics-lite
.resize(w, h)                  // CSS px
.update(dt)                    // call once per frame BEFORE render: time of day, uniforms (camera pos, sun, fog, wind time), shadow-camera snapping
.render(worldForShadows)       // sky + scene (+ shadow pass using world.getShadowCasters) + post. Optional arg may be null.
.info()                        // { calls, triangles, geometries, textures, renderScale, quality, fps? }
.dispose()
```
Also export from `src/render/index.js`: `GameRenderer`, `TimeOfDay`.
Debug hook: `window.__hz.gameRenderer` is set by main.

### 4b. `src/world/World.js` — `export class World` (WORLD)
```js
new World({ seed /* int */, scene /* THREE.Scene or Group parent */, materials, quality /* preset obj */, onProgress /* (0..1) => void */ })
.group        // THREE.Group containing all chunk/LOD meshes (World adds it to `scene`)
.update(camera, dt)  // per frame: decide needed chunks/LOD tiles around camera.position (quadtree/LOD selection), dispatch worker jobs (prioritised: nearest + in view first), upload finished meshes within quality.meshUploadMs, hide LOD tiles replaced by finished finer ones (NEVER leave holes: keep the coarse parent visible until all its finer children are ready), unload far stuff (LRU), animate nothing heavy
.isReady()    // true when the area around the camera (chunkRadius>=2) is meshed — used to dismiss the loading screen; also onProgress feeds it
.getBlock(x, y, z)           // int coords; B.UNLOADED if the column's data isn't loaded; B.AIR above WORLD_HEIGHT, B.BEDROCK below 0
.setBlock(x, y, z, id)       // player edit: updates voxel data, overlay, remeshes chunk (+ neighbours when on border) with high priority; returns true if applied
.raycast(origin /*Vector3*/, dir /*normalized Vector3*/, maxDist) // -> null | { x,y,z (hit block), nx,ny,nz (face normal), block, dist } — DDA on loaded voxels, ignores AIR/liquid? (hits solid + cross-plants; skip water)
.getSurfaceY(x, z)           // sync, from terrain functions (works for unloaded columns): y of highest solid block (ignoring trees) -> spawn height = this + 1.. (sea floor if ocean: return max(surface, SEA_LEVEL))
.getShadowCasters(center /*Vector3*/, radius, out /*Array*/)  // push chunk `solid` meshes within radius into `out`; sets/clears mesh.layers bit 1 for casters (RENDER renders camera.layers.set(1) with overrideMaterial)
.setQuality(preset)          // new view distance / chunkRadius / lodFactor / budgets / worker count; unload what's no longer needed
.stats()                     // { chunks, chunkQueue, lodTiles, lodQueue, workersBusy, tris, genMsAvg, meshMsAvg, uploadsPerFrame, dataChunks }
.dispose()                   // terminate workers, free geometries
```
Export also `src/world/terrain.js`: `createTerrain(seed)` -> `{ surfaceY(x,z), biomeAt(x,z), ... }` used by the main thread for spawn.

### 4c. `src/main.js` (GAME) glue, per frame order
`player.update(dt)` → `world.update(camera, dt)` → `gameRenderer.update(dt)` → `gameRenderer.render(world)` → HUD/debug. `world.group` added to `gameRenderer.scene`.
URL params (for tests & sharing): `?seed=N&quality=potato|low|medium|high|ultra|auto&autostart=1&time=HH.H&x=&z=&y=&yaw=&pitch=&fly=1&mock=1&notouch=1`.
`window.__hz = { ready:boolean, world, gameRenderer, player, camera, setQuality(name), teleport(x,y,z), lookAt(yawDeg,pitchDeg), setTime(h), screenshotReady(), stats() }` — `ready` becomes true once `world.isReady()` and one frame rendered. **Required** (orchestrator tests rely on it).

## 5. Gameplay baseline (GAME)
Pointer-lock FPS controls (WASD, mouse, Space jump, Shift sprint, Ctrl/C crouch-or-descend, **F toggles fly**, double-tap Space = fly), swimming, AABB voxel collision (0.6×1.8, no tunnelling at high speed, step handling), LMB break (with crack animation/time, particles), RMB place (not inside player), 1-9 / wheel hotbar, `E` block palette, `T` cycle time, `F3` debug overlay (FPS, frame-time graph, draw calls, tris, chunks, LOD tiles, workers, quality, renderScale, x/y/z, biome), `F2` screenshot, `Esc` menu (settings: quality preset incl. Auto, render distance slider, fov, mouse sens, volume, time speed), main menu with seed input + "Mundo novo" + quality select, loading screen with progress, mobile touch (virtual joystick + look drag + buttons) auto-detected, crosshair, block highlight outline (LineSegments, custom), hotbar with 3D-ish/flat icons rendered from the procedural tiles. UI text in **Portuguese (pt-BR)**.
**AutoQuality** (GAME owns, `src/game/AutoQuality.js`): measure frame time EMA + p95 over ~2 s windows; if p95 > 1.25×target(16.7ms) for 2 consecutive windows → step down in this order: renderScale (1→0.85→0.7→0.55→0.4) → quality preset (down one tier, renderScale back to 0.85) …; if p95 < 0.7×target for 10 s → step up. Hysteresis, never oscillate (min 8 s between changes), pause while loading screen or tab hidden, initial tier guessed from `hardwareConcurrency`, `deviceMemory`, mobile UA, `renderer` string (SwiftShader/llvmpipe/Intel HD → potato/low).

## 6. Done = 
`npm run dev` → open → menu → click Play → pretty infinite world, smooth, no holes between LOD0/LOD levels, no console errors, `npm run build` passes.
Final report (≤ 25 lines): what works, what's stubbed, known issues, file list, exact API deviations from this contract (be honest).
