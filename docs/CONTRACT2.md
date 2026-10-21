# HORIZON 2 — Planetas, P2P e Minigames (CONTRACT, binding for the 4 feature agents)

**Pitch.** *No Man's Sky × Minecraft × Garry's Mod, hosted as static files (GitHub Pages), zero servers.*
Every player owns a **planet** (a seed + their edits). Planets can be **opened to friends** (WebRTC peer-to-peer, the planet owner is the host) or kept closed behind a **dome**.
Anyone can build **minigames** with in-world tools; a minigame is *data* (JSON), never code, so it can be shared as a code/link safely.
The engine (infinite LOD world, shaders, post-fx, mobs, weather, saves) already exists and is the base: **do not break it**; potato hardware must still run it (heavy features are quality-gated).

Read first: `docs/CONTRACT.md` (engine formats), this file, `src/main.js` (just the `buildCtx` / `startGame` parts), `src/features/example/index.js` (plugin template), `src/features/registry.js`, `src/ui/ui.js` (the "feature API" section).

## 0. Rules for everybody
* UI text: **pt-BR**. No external assets/fonts/images (procedural only; inline SVG/canvas OK). ES modules, no TypeScript. Keep files < ~900 lines. JSDoc on public APIs. No dead code.
* **No per-frame allocations** in hot paths; features gated by quality where costly (`ctx.settings.quality` / `ctx.gr.quality`). Nothing may run when the feature is idle.
* **Static hosting only.** No server of ours. WebRTC works on https (GitHub Pages) but NOT inside the Claude Artifact sandbox: features must degrade gracefully (`typeof RTCPeerConnection === 'undefined'` or a failed connection ⇒ solo mode, with a friendly message).
* Safe by construction: anything imported from another player (minigame JSON, snapshots, network messages) is **untrusted data**: validate shapes/limits, never `eval`/`Function`/innerHTML-unescaped, clamp numbers, cap counts.
* Test headless with `node scripts/shot.mjs <url> <png> ...` and `node scripts/views.mjs ...` (see scripts). **The machine has 4 cores shared by 4 agents and software WebGL**: use `quality=potato|low`, small viewports (`--w=640 --h=360`), don't leave browsers running, use your own dev server port (U 5301, N 5302, G 5303, M 5304: `cd /home/user/horizon && npx vite --port <p> &`), scratchpad for outputs: `/tmp/claude-0/-home-user/909ae463-6711-55a8-ad26-4029f138c696/scratchpad/`. `window.__hz.ctx()` exposes the live ctx in tests.
* **Shared files** (`src/shared/blocks.js`, `src/render/textures.js`, `src/ui/style.css`, `src/main.js`, `src/world/*`, `src/render/*`): re-read right before editing, keep edits small and localized (append in your own marked section, e.g. `// --- items ---`). Never reformat or reorder others' code. Never delete others' code.
* Do not run `git`. Do not touch `package.json` unless your brief says so (N may `npm i` the packages it names).
* **Hard stop: 21:45 UTC** (`date -u`). Have a *working core* by ~21:10 (it must load without console errors with your feature on AND must not break the game if your feature throws), then polish. A feature that throws is skipped by the registry, but a broken shared file breaks everybody: after every edit to a shared file run `node --check <file>` and a quick `plumb`-style load (see `scripts/` or write a 20-line playwright check).
* Final report ≤ 25 lines: what works (and how you verified), what is stubbed, public API deviations from this contract (honest), files touched outside your folder, known issues.

## 1. Plugin architecture (already implemented — use it, don't change it)
A feature is `src/features/<id>/index.js` exporting `default defineFeature({ id, order, menu?, resolvePlanet?, init?, ready?, update?, dispose? })` (see `src/features/registry.js`). Folders are discovered automatically (`import.meta.glob`). Import your own CSS from your folder (`import './x.css'`).

Lifecycle: `menu(api)` runs in the main menu (no game yet; `api = { ui, identity, settings, events, startGame(opts) }`) → player clicks play (or a feature calls `api.startGame`) → `resolvePlanet(req)` (first feature returning a PlanetInfo wins) → world/renderer/player created → `init(ctx)` → loading screen → `ready(ctx)` → `update(dt, ctx)` every frame.
`startGame(opts)`: `{ seedStr?, planet?: PlanetInfo, edits?: number[], net?: NetSession, role?: 'solo'|'host'|'guest' }`.

### `ctx` (see `buildCtx` in main.js)
`THREE, events, identity{id,name,color}, settings, ui, audio, registry, permissions, localState{team,hp,item,extra}, gr(GameRenderer), camera, player, controls, interaction, world, hotbar, mobs, planet(PlanetInfo), role, net, addHotkey(code,fn), removeHotkey(code), state, ready`.
Features publish their own API on `ctx` in `init` (see §3) — others must treat those as **optional** (`ctx.items?.…`), the owning feature may have failed to load.

### UI API (`ctx.ui`)
`panel({id,title,content:HTMLElement|string,width,subtitle,onClose}) → {el,body,close(),setTitle()}` (modal; suspends gameplay input; Esc/✕ closes; same `id` toggles) · `addMenuButton({label,onClick,hint,kind})` · `addToolbarButton({id,icon,title,key,onClick})` (right edge of the HUD) · `setPlanetBadge(html)` · `hudLayer` (absolute container inside the HUD for widgets; children get pointer events) · `toast(msg)`. Existing CSS classes: `.panel .panel-head .btn .btn.primary .btn.ghost .btn.danger .field .row .note .dim kbd`.

### Events (`ctx.events`, pub/sub)
Engine: `world:blockSet {x,y,z,id,prev,source:'local'|'remote'|'game'}` · `world:ready` · `planet:enter {planet}`.
Namespaces by owner: `net:*` (N) · `dome:*` (N) · `player:*`, `item:*`, `inventory:*` (G) · `game:*`, `mg:*` (M) · `universe:*` (U). Payloads are plain JSON-able objects. Document yours in your doc file.

### World API additions
`world.setBlock(x,y,z,id, source='local')` (needs chunk voxels loaded; emits event) · `world.applyEdit(x,y,z,id, source='remote')` (works for unloaded chunks too, remeshes if visible) · `world.exportEdits()` / `world.importEdits(list)` · `world.editRev` · `world.getBlock/raycast/getSurfaceY` as before.
Edits from the network or minigame logic MUST use `applyEdit` (never `setBlock`). Player breaking/placing goes through `Interaction` (G) which calls `ctx.permissions.can('break'|'place', {x,y,z,id,by})` first.

### Permissions (`ctx.permissions`)
`add(action, fn(info) → false|undefined) → remove()`, `can(action, info) → boolean`. Actions: `break place pvp fly use-item explode`. N registers guest/dome rules; M registers minigame rules (e.g. only floor blocks breakable); G calls `can` before applying any of those.

## 2. Authority model (applies to every feature)
`ctx.net.isAuthority` is true when solo **or** host. **Authority simulates** (minigame logic, explosions, mob AI, projectiles hitting, scores); **guests send intents** (`net.send('intent:...')`) and **render replicated state**. Edits made by authority-side game logic are applied with `applyEdit(..., 'game')` and N rebroadcasts them. Trust model is friendly (no anti-cheat) — document, don't fight it.

## 3. Public APIs each feature publishes on `ctx` (exact shapes; others code against these)

### U — Universe (`ctx.universe`)
```js
ctx.universe = {
  planet,                         // current PlanetInfo (== ctx.planet)
  homeAddress(identityId) -> string,
  profileFor(address) -> PlanetProfile,
  describe(address) -> { name, type, summary },
  openMap(),                      // galaxy/system map panel (key J)
  travel(address),                // fade + reload into ?planet=ADDRESS (disabled with a toast when role !== 'solo')
  visited: string[],              // addresses visited (persisted)
};
```
**PlanetInfo** `{ seed:int, address:string|null, name:string, type:string, profile:PlanetProfile|null, ownerId:string, ownerName:string, isHome:boolean, domeMode:'closed'|'open'|'invite' }` — JSON-serializable (it travels in network snapshots). `profile:null` ⇒ the legacy world, bit-identical to today (old saves keep working). `address` = `XXXX-XXXX-XXXX` (Crockford base32) that fully determines seed+profile; a home planet's address derives from `identity.id`.
**PlanetProfile** is defined and documented by U in `docs/PLANETS.md` (terrain params, palette tints, sky/atmosphere, sea fluid, gravity, day length, flora/fauna weights, structure toggles). It must be JSON, small, and understood by the chunk worker (passed at worker init), LOD mesher, terrain, and renderer. Gravity: U sets `ctx.player.gravityScale` (G guarantees Player honours it, default 1). New block types are NOT needed for planets (use tint tables); if you truly need one, ask in your report.
The **dome visual** (translucent energy shell around the home spawn, shader-based, cheap, quality-gated) belongs to U and reads `ctx.dome.mode` (N) + listens to `dome:change`.

### N — Net (`ctx.net`, `ctx.dome`) — never null after init (solo = no-op object with the same shape)
```js
ctx.net = {
  role: 'solo'|'host'|'guest', isAuthority: boolean, localId: string, hostId: string|null,
  players: Map<id, RemotePlayer>,          // REMOTE players only. RemotePlayer = { id, name, color, pos:THREE.Vector3 (smoothed), yaw, pitch, vel:THREE.Vector3, hp, team, item, alive:boolean, ping:number }
  on(type, fn(data, fromId)) -> off,       // custom messages, namespaced strings ('mg:state', 'combat:hit', ...)
  send(type, data, {to?, reliable=true}),  // guest → host (to ignored); host → `to` (required)
  broadcast(type, data, {except?, reliable=true}),  // everybody else; a guest's broadcast is relayed by the host
  registerSnapshot(key, { get():any, set(data):void }),  // included in the welcome snapshot a joining guest receives
  startHosting(opts) -> Promise<HostInfo>, stopHosting(), kick(id), 
  latency(id?) -> ms,
};
ctx.dome = { mode:'closed'|'open'|'invite', set(mode), perms:{ build:boolean, break:boolean, pvp:boolean, fly:boolean }, setPerm(k,v), maxPlayers:number };
```
Local state sent ~15 Hz with position: `ctx.localState` (`team`, `hp`, `item`, `extra`) — G/M write it, N reads it. Events: `net:peerJoin {peer}`, `net:peerLeave {id}`, `net:role {role}`, `dome:change {mode}`. Menu: "Entrar em um planeta" (code / link) before a game exists; panel key **O** during a game (host: open/close dome, invite code/QR, player list, kick, permissions, chat; guest: player list, chat, leave).
Joining flow: guest connects in the **menu phase**, receives `welcome {planet, edits, time, weather, snapshots{}}`, then calls `api.startGame({ planet, edits, net, role:'guest' })`. Guests do not save locally (`G.saveOn=false` is automatic for role guest).

### G — Items, health, combat (`ctx.inventory`, `ctx.health`, `ctx.items`, `ctx.combat`)
```js
ctx.items = { get(id) -> ItemDef|null, all() -> ItemDef[], register(def) }   // ItemDef = { id:string, name, category:'tool'|'weapon'|'special'|'block'|'minigame', icon:(canvas)=>void | tile, stack:number, use?:(ctx,hand)=>void, ... }
ctx.inventory = { slots:(number|string|null)[9], sel:number, creative:boolean, give(id,n?), take(id,n?), has(id), clear(), setLoadout(ids[]), lock(bool), selected(), onChange(fn) }
// hotbar slot values: number = block id (existing behaviour), string = item id from the registry, null = empty
ctx.health = { hp, max, damage(n, src), heal(n), kill(), respawn(), spawnPoint:THREE.Vector3|null, invulnerable:boolean, alive:boolean }   // events: player:damage {amount,src,hp} player:die {src} player:respawn
ctx.combat = { hitPlayer(id, amount, {knockback?:THREE.Vector3, weapon?:string}), explode(x,y,z, power, {by?, breakBlocks=true}), projectile(...) }
```
`ctx.player.gravityScale` and `ctx.player.extraJumps/flyMode` hooks are G's (Player.js). `ctx.inventory.lock(true)` freezes hotbar editing (minigames hand out loadouts). Combat is **authority/victim-resolved**: attacker detects the hit locally and sends `combat:hit` to the victim, whose client applies damage (friendly trust model).

### M — Minigames (`ctx.mg`)
```js
ctx.mg = { openEditor(), openBrowser(), current:GameDef|null, state:'idle'|'lobby'|'countdown'|'running'|'ended', start(def?), stop(), localTeam, teamOf(id), exportCode(def)->Promise<string>, importCode(str)->Promise<GameDef>, templates:GameDef[] }
```
GameDef (JSON) format, rule engine and limits: documented by M in `docs/MINIGAMES.md`. Rules are an event→condition→action table over a **closed enum** of events/conditions/actions (no scripting). Items referenced by id resolve through `ctx.items.get` (unknown ⇒ skipped with a warning). Logic objects (spawns, goals, checkpoints, kill zones, triggers, pads, doors, signs) are **entities** stored in the GameDef (not voxel blocks), shown only in editor mode as translucent volumes. M may append a few *voxel* blocks (spawn pad, barrier…) to `blocks.js` with ids **70–89**; G uses **51–69**.

## 4. Hotkeys / toolbar (reserved)
`E` inventory/creative palette (G) · `J` galaxy map (U) · `O` online/dome (N) · `Y` minigames (M). Already used: `W A S D Space Shift Ctrl C F T L K P M 1–9 F2 F3 Esc` and mouse. Mobile: toolbar buttons only.

## 5. Acceptance demo (the orchestrator will run this at the end)
1. Menu: name field, "Jogar no meu planeta", "Entrar em um planeta" (N), planets look different from each other (U).
2. In game: `J` opens the galaxy map, jump to an alien planet (new sky/palette/gravity), jump back; `E` shows tools (sword, bow, TNT, gravity gun, jetpack, grapple); hearts + respawn work.
3. `O`: open the dome → a code; a second browser context joins using it (tested headless with a Node script); positions, edits, chat sync; closing the dome kicks/blocks.
4. `Y`: build a Parkour game with spawn/checkpoints/goal in the editor, start it, finish it, scoreboard shows; templates (Parkour, Spleef, TNT Run, Capture the Flag, Last Man Standing) start without errors; export → import round-trips.
5. Potato tier: none of the above adds per-frame cost when idle; console has no errors; `npm run build` passes.
