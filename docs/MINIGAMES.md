# HORIZON — Minigames (feature `minigame`, agent M)

A minigame is **data (JSON)**, never code. It can be saved, duplicated, exported as a short code (`HZG1.…`) or a link (`?game=HZG1.…`) and imported by anybody, safely: every import is rebuilt field by field and clamped by `src/features/minigame/schema.js`. Press **Y** (toolbar 🎮) in game.

Files (all in `src/features/minigame/`): `schema.js` (format, limits, validator, descriptors) · `codec.js` (share codes) · `runtime.js` (rule engine + state machine, pure logic) · `session.js` (glue to the live game, replication, permissions, effects) · `hud.js` · `view3d.js` (instanced entity visuals) · `editor.js` + `dom.js` · `browser.js` · `store.js` (`localStorage` key `horizon.games.v1`) · `templates.js` · `minigame.test.mjs`.

## 1. GameDef (version 1)

```jsonc
{
  "v": 1,
  "meta": { "name": "Parkour", "author": "", "description": "…", "color": "#60a5fa", "icon": "🏃",
            "mode": "solo|coop|ffa|teams", "minPlayers": 1, "maxPlayers": 8, "timeLimit": 0,   // seconds, 0 = none
            "lives": 0, "onDeath": "respawn|eliminate", "pvp": false, "allowBuild": false,
            "laps": 1, "countdown": 3, "resultsTime": 12, "teamStart": "balance|first",
            "teams": [{ "id": "red", "name": "Vermelho", "color": "#ef4444" }] },            // ≤ 4, needed for mode "teams"
  "anchor": { "x": 0, "y": 64, "z": 0 },        // world position; EVERYTHING below is relative to it, so a game can be pasted anywhere
  "entities": [ { "id": "e1", "type": "checkpoint", "x": 0, "y": 0, "z": 4, "w": 3, "h": 3, "d": 3, "name": "", "p": { "order": 1 } } ],
  "rules":    [ { "id": "r1", "when": { "ev": "playerEnter", "entity": "e3" },
                  "if":   [ { "c": "score", "op": ">=", "value": 1 } ],
                  "then": [ { "a": "message", "who": "actor", "text": "Oi!" } ], "once": false } ],
  "loadout": [ { "item": "sword", "count": 1 } ],     // resolved through ctx.items (unknown ids are skipped; no items system ⇒ ignored)
  "vars":    { "coins": 0 },                         // initial values of rule variables
  "win":     { "type": "goal|lastAlive|score|teamScore|time|none", "target": 1 },
  "arena":   [ { "x": 0, "y": -1, "z": 0, "w": 5, "h": 1, "d": 5, "material": "stone", "shape": "hollow?" } ]   // map built at every round start
}
```

* An entity is a box: min corner `x,y,z` + size `w,h,d` (blocks, integers). Its `p` holds the per-type props below. `id` is `[A-Za-z0-9_-]{1,16}`.
* `arena` ops are filled with blocks (`material` = block *name*, `"air"` allowed) when a round starts, so *Jogar de novo* always begins from a clean map. `area`/`door` entities are (re)filled too (only when the area has `restore:true`; default false so a floor you built by hand is never overwritten).
* Materials are block names (see `MATERIALS` in `schema.js`), so games survive block-id changes.

### Entity types (`type`, props `p`)
| type | props | built-in behaviour |
|---|---|---|
| `spawn` | `team` | where players appear (team spawns first, then team-less ones) |
| `goal` | `needCp` | touching it finishes (a lap when `meta.laps > 1`); `needCp` = all checkpoints first |
| `checkpoint` | `order` 1–99 | saves progress and the respawn point |
| `killzone` | – | touching = death |
| `trigger` | – | invisible; only for rules (`playerEnter`/`playerExit`) |
| `pad` | `kind` boost/jump/teleport, `power`, `target` | launches or teleports (0.5 s cooldown) |
| `itemGiver` | `item`, `count`, `cooldown` | gives an item on entering |
| `button` | `cooldown` | stepping on it fires `buttonPressed` |
| `door` | `material`, `open` | solid block volume; `openDoor`/`closeDoor` actions |
| `sign` | `text` | shows the text on entering |
| `flag` | `team` | capture the enemy flag and bring it to your own base (+1 score) |
| `zone` | `rate`, `hold` | the only team/player inside gets `rate` points every `hold` s |
| `area` | `kind`, `material`, `breakable`, `crumble`, `restore` | a block region: `breakable` = players may break it; `crumble` s = blocks vanish that long after being stepped on (TNT Run) |

### Rules: event → conditions → actions (closed enums; no scripting, no `eval`)
Events: `gameStart`, `playerEnter{entity}`, `playerExit{entity}`, `playerDied`, `playerKilled`, `blockBroken{area}`, `itemUsed{item}`, `timer{id}`, `scoreReached{value}`, `buttonPressed{button}`, `tick{every}`, `playersTouch{team,other}`.
Conditions (all must hold): `team`, `score`, `teamScore`, `teamCount`, `aliveCount`, `hasItem`, `time`, `random`, `variable` (compare ops `>= > == != <= <`).
Actions: `teleport`, `giveItem`, `setLoadout`, `damage`, `heal`, `kill`, `respawn`, `setBlock`, `fillArea`, `removeBlocks`, `addScore`, `setVar`, `setTeam`, `message`, `title`, `sound`, `startTimer`, `stopTimer`, `openDoor`, `closeDoor`, `eliminate`, `endGame`.
`who` selectors: `actor` (whoever triggered the event; for events with no player — start, tick, timer — it means everybody), `all`, `team`, `others`, `enemies`, `alive`, `random`, `victim` (the other player of `playerKilled`/`playersTouch`).
Events fired by actions (e.g. `addScore` → `scoreReached`) are queued, never recursive. `once:true` = at most one firing per round.

### Phases and winning
`idle → lobby → countdown → running → ended`. Countdown waits until the arena is built, then shows 3‑2‑1‑VAI!. The game ends by `win` (`goal`: first `target` finishers · `lastAlive` · `score`/`teamScore` ≥ `target` · `time`: survive the clock · `none`), by `meta.timeLimit`, or by an `endGame` rule. Results: ranking (finish time → score → alive → kills), winner (player or team), team table.
Death: `onDeath:"respawn"` returns the player to the last checkpoint/spawn after 1.2 s; `"eliminate"` makes them a flying spectator; `lives > 0` counts down first. Without the health system (`ctx.health`) only kill zones and the `kill` action kill (and respawn by teleport).

### Hard limits (`LIMITS`)
entities ≤ 300 · rules ≤ 200 · conditions/rule ≤ 8 · actions/rule ≤ 16 · **actions per tick ≤ 64** · **blocks per tick ≤ 2000** (≤ 500 on potato; larger fills are queued across ticks) · text ≤ 120 chars · size ≤ 96/axis, ≤ 120 000 blocks/volume · coordinates ±4096 · teams ≤ 4 · players ≤ 16 · arena ops ≤ 160 / ≤ 250 000 blocks · share code ≤ 400 000 chars, decompressed ≤ 1.5 MB. Text is only ever shown with `textContent`.

## 2. Share codes
`HZG1.<base64url(deflate-raw(JSON))>.<crc32 hex>` (`HZG1r.` = uncompressed, used when `CompressionStream` is missing). Import accepts the code, a link containing `?game=<code>`, or raw GameDef JSON; verifies the checksum, caps the decompressed size, then runs the full validator (bad fields are clamped/dropped and reported as warnings). Opening a link with `?game=…` saves the game to the browser list. A typical template code is 1.5–3 KB.

## 3. Runtime and networking
* The runtime lives **only on the authority** (solo or host: `ctx.net.isAuthority`). Idle cost is zero: no `update` work unless a game/editor is on. It ticks at 15 Hz with a cheap AABB broad phase; players are read from `ctx.net.players` (feet position, `alive`).
* Authority → guests: `mg:start {code, view}` (game code, once; also sent to late joiners and in the `mg` snapshot), `mg:state <view>` (≤ 5 Hz, only when something changed or every second; compact arrays), `mg:fx {t,d}` (targeted effects: `tp vel msg title sound give loadout clear spec team respawn damage heal kill spawnpoint end`), `mg:stop`. Guests send no `intent:*` (positions and block edits already travel through N's normal path; the host reads `ctx.net.players`) and the authority ignores every incoming `mg:*` message; the host never trusts guest input beyond positions/edits (friendly trust model, no anti-cheat).
* Guests rebuild the HUD and enforce the same block permissions locally from the received game.
* **Permissions** (`ctx.permissions`) while a round is in `countdown/running`: `place` denied unless `meta.allowBuild`; `break` allowed only inside `area` entities with `breakable` (or when `allowBuild`); `pvp` = `meta.pvp`; `explode` denied. As a safety net the session reverts any local edit that the permission table denies (so it works even if the item layer forgets to ask), and fires `blockBroken` for edits that happened inside an `area`.
* World edits made by the game use `world.applyEdit(…,'game')` (N rebroadcasts them), capped per tick.
* Integration with G (`ctx.items/inventory/health`): events `player:die {src}` (killer name/id resolved against the round's players) and `item:use {id}` feed `playerDied/playerKilled/itemUsed`; loadouts use `inventory.setLoadout([{id,n}])` + `lock(true)` and the player's own hotbar is restored at the end; `kill`/`damage`/`heal` call `health.*`; `health.spawnPoint` follows checkpoints. Killzone deaths are handled by the game itself (instant teleport back, no death screen).
* Optional dependencies (all guarded): `ctx.items`/`ctx.inventory` (loadouts, item givers; ids resolve exactly, then by substring), `ctx.health` (kill/respawn/`spawnPoint`; events `player:die`), `ctx.audio` (tiny procedural beeps on its AudioContext), `ctx.net` (null/solo ⇒ no replication).

## 4. Editor (key **Y**)
* **Y** opens the hub (first time) / the editor dock. The dock is a see-through right-hand panel (⇄ swaps side), so the world stays visible. Esc closes the dock but keeps *editor mode*: every entity is drawn as a translucent coloured volume with outlines and (non-potato) icon labels — one instanced draw + one line draw. Leave with *Arquivo → Sair do editor*.
* **Objetos**: *Adicionar na mira* places the entity at the crosshair (grid-snapped to blocks; the first entity also sets the anchor). Select by clicking it in the world while the dock is open, by **Q** under the crosshair, or from the list. Edit name/position/size/props, nudge ±1 (Shift = 5), duplicate, delete, *Ir até*, *Preencher agora* (areas/doors). Undo/redo (80 steps). With the dock closed: **Numpad 4/6/8/2/9/7** move the selection (X−/X+/Z−/Z+/Y+/Y−), **Shift+those** resize it (largura/profundidade/altura), **Del** deletes.
* **Regras**: dropdown rule builder (QUANDO / SE / ENTÃO) generated from the schema tables — no JSON typing.
* **Jogo**: name, description, colour, mode + teams, players, time limit, lives, death mode, laps, PvP, building, win condition, loadout, *Mover o jogo para onde estou*, *Construir arena aqui*.
* **Arquivo**: **▶ Testar agora** (starts right here; ends back in the editor), save (`localStorage`), open/templates, new, generate/copy code, copy link, download `.json`, import box.
* The browser (🕹️ / *Abrir*) lists your saved games and the 8 templates with *Jogar aqui*, *Editar cópia*, *Duplicar*, *Código*, *Excluir*.

## 5. Templates (generated in code, validated like any import)
Parkour · Spleef (2 snow layers, break to win) · TNT Run (floor crumbles 0.6 s after stepping, 2 floors) · Corrida (oval track, 3 laps, 3 checkpoints, boost pads) · Capture a Bandeira (2 teams, bases, first to 3) · Rei do Morro (zone, first to 30) · Pega-Pega (infection via `playersTouch`) · Último de Pé (sword/bow loadout, eliminate). All are sky arenas (`lift` blocks above the player) so they never collide with terrain; falling into the kill zone is the only way out.

## 6. Public API (`ctx.mg`, see CONTRACT2 §3)
`openEditor() · openBrowser() · current · state · start(def?) · stop() · localTeam · teamOf(id) · exportCode(def) → Promise<string> · importCode(str) → Promise<GameDef> · templates: GameDef[]`. Extras: `_session`, `_editor`, `_api` (tests). Events on `ctx.events`: `mg:start {name}`, `mg:stop`.

## 7. Tests
`node src/features/minigame/minigame.test.mjs` — schema hardening (hostile input, caps), share-code round trip + tampering + decompression bomb, every template lints clean, and the runtime driven by a fake host (parkour, spleef permissions, TNT crumble, CTF, rule engine with timers/variables/budget, tag infection, joins/leaves, zero idle work, block cap).
