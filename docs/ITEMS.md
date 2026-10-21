# HORIZON — Itens, vida e combate (feature `items`, agente G)

Código em `src/features/items/`. Publica `ctx.items`, `ctx.inventory`, `ctx.health`, `ctx.combat` (CONTRACT2 §3 "G"). Texto da UI em pt-BR, tudo procedural (sem assets).
Custo ocioso medido (300 quadros, hotbar só com blocos / com espada / com jetpack parado): **0,001–0,002 ms por quadro**, sem alocações no caminho quente (entidades, fila de explosão, HUD e partículas retornam antes de qualquer trabalho quando vazios).

## Controles
| Ação | Tecla / botão |
|---|---|
| Inventário / criativo | `E` (abas Blocos · Ferramentas · Armas · Especiais · Minigame, busca, clique = equipa no slot selecionado, arrastar para um slot, botão direito num slot = limpa, `1`–`9` troca de slot) |
| Usar item (primário) | botão esquerdo · segurar para arco / gancho |
| Usar item (secundário) | botão direito (arma de gravidade pega/solta, TNT coloca bloco, escudo bloqueia) |
| Roda do mouse | troca de slot — **ou** aproxima/afasta o bloco segurado pela arma de gravidade |
| Jetpack | segurar `Espaço` no ar (com o jetpack na mão) |

## Itens embutidos
| id | nome | uso |
|---|---|---|
| `sword` | Espada | golpe em arco (até 3 alvos, 6 de dano, empurra); acerta animais e jogadores remotos |
| `bow` / `arrow` | Arco / Flecha | segurar = puxar (0,9 s), soltar = atirar; flecha parabólica que crava no bloco (45 s) e acende TNT; fora do criativo consome `arrow` |
| `tnt` | TNT | esq.: arremessa TNT aceso (ou acende o bloco TNT mirado) · dir.: coloca o **bloco TNT (id 51)** |
| `lighter` | Isqueiro | acende blocos TNT |
| `gravity_gun` | Arma de Gravidade | dir.: pega o bloco mirado (some do mundo, flutua à frente) / solta · esq.: arremessa (dano ao acertar) ou empurra mobs, TNT e blocos soltos · roda: distância. O bloco volta a ser colocado onde pousa |
| `jetpack` | Jetpack | combustível 6 s, recarrega no chão; barra de combustível no HUD |
| `grapple` | Gancho | esq. segurado: lança e puxa; soltar ou `Espaço` larga |
| `snowball` | Bola de neve | arremesso, 0 dano mas empurra animais e jogadores |
| `prop_gun` | Arma de Props | esq.: dispara um prop físico (caixa / barril / bola que quica e rola; empurrável a pé, por explosões e pela Arma de Gravidade); dir.: troca o prop; máx. 24 |
| `wand` | Varinha Mágica | cria um animal aleatório (`ctx.mobs`) onde você mira |
| `pickaxe`, `axe` | Picareta, Machado | quebram pedra / madeira 3,6× mais rápido (outros blocos 1,7×) |
| `fireworks` | Foguete | sobe e explode em faíscas |
| `pearl` | Pérola de teletransporte | teletransporta até onde cair (-2 de vida) |
| `feather` | Pena | na mão: queda lenta e sem dano de queda |
| `boots` | Botas de velocidade | na mão: 1,65× de velocidade |
| `shield` | Escudo | segurar o botão direito: -80 % de dano |
| `apple` | Maçã | +4 de vida |
| `build_wand` | Varinha de Construção | dois cliques marcam um cubóide, preenche com o bloco do slot seguinte (máx. 4096 blocos, fila de 500/quadro) |
| `paint` | Pincel | esq.: troca o bloco mirado pela cor atual (terracotas/corais/…); dir.: muda a cor |

Mobs mortos soltam carne (entidade que cura 3 ao tocar). Números de dano flutuam sobre o alvo; um "kill feed" aparece no canto superior esquerdo.

## Vida (`ctx.health`)
20 hp (10 corações no HUD), flash vermelho + tremor de câmera ao receber dano, **dano de queda** (`floor(altura - 3,5)`, escala com `player.gravityScale`), **afogamento** (10 s de ar; bolhas no HUD), **lava** (2 por 0,5 s), **vazio** (`y < -12`), regeneração lenta após 8 s sem dano, tela de morte com **Renascer** (ou Enter), invulnerabilidade de 3 s após renascer.
`health = { hp, max, alive, invulnerable, spawnPoint: Vector3|null, guard, damage(n, src), heal(n), kill(src?), respawn() }`. `src` é `'fall' | 'drown' | 'lava' | 'void' | 'explosion' | 'generic'` ou `{ kind, by, weapon }`. Renasce em `spawnPoint` ou, se nulo, na posição inicial do planeta (guardada no `ready`).
Eventos: `player:damage { amount, src, hp }` · `player:die { src }` · `player:respawn {}`. `ctx.localState.hp` é mantido atualizado (e `localState.extra.alive`).

## Inventário (`ctx.inventory`)
Os slots são o array `ctx.hotbar.slots` (9 posições): `number` = bloco, `string` = id de item, `null` = vazio; salvo junto com o jogo (`Save.js`; ids desconhecidos viram vazio ao carregar).
`{ slots, sel, creative (padrão true = ilimitado), give(id, n?), take(id, n?), has(id, n?), clear(), setLoadout(ids[] | {id,n}[]), setSlot(i, v), lock(bool), locked, selected(), onChange(fn) → off }`. Fora do criativo os slots têm contagem (badge no hotbar) e `take` consome. `lock(true)` congela edição do hotbar (UI, `pickBlock`, picks do botão do meio). Evento: `inventory:change { slots, sel, item }`, `inventory:lock { locked }`.

## Registrar um item (outras features)
```js
ctx.items.register({
  id: 'meu_item', name: 'Meu item', category: 'minigame',    // 'tool'|'weapon'|'special'|'block'|'minigame'
  icon: (canvas) => { /* desenha em 32×32 */ },               // ou id de bloco (number) / nome de modelo
  stack: 16, cooldown: 0.4, desc: 'texto na bandeja',
  model: { boxes: [[x0,y0,z0,x1,y1,z1,[r,g,b], part]], scale: 0.015, pos: [0.25,-0.3,-0.5], rot: [-0.3,-0.3,0.3], swing: 'slash' },   // modelo em 1ª pessoa (opcional)
  use(ctx, hand, S, st, inp) {}, useSecondary(ctx, hand, S, st, inp) {}, onHold(ctx, hand, S, st, inp) {}, onSelect(...) {}, onDeselect(...) {},
  mining: 2,   // (opcional) multiplicador de velocidade ao quebrar blocos; deixa o botão esquerdo quebrar
});
```
`hand` = `gr.hand`; `S` = runtime interno (`ctx.itemsRuntime`: `combat`, `ents`, `player`, `audio`, `hud`, `inventory`…); `inp = { dt, p, s, pPressed, pReleased, sPressed, sReleased }`. `use`/`useSecondary` só rodam se `ctx.permissions.can('use-item', { item, by })`. Evento `item:use { id, secondary }` em cada uso. `part` das caixas: 0 estático · 1 puxado pela carga do arco · 2 emissivo · 3 emissivo pulsante · 4 chama do jetpack.

## Combate (`ctx.combat`)
* `hitPlayer(id, amount, { knockback?:{x,y,z}, weapon? })` — só faz algo se `ctx.net.players` tem `id`; checa `permissions.can('pvp')`; envia **`net.broadcast('combat:hit', { victim, by, byName, amount, kb:[x,y,z], weapon })`**. O cliente `victim` aplica dano + knockback (`player.impulse`) depois de validar/clampar (dano ≤ 40, knockback ≤ 30) e checar `pvp` de novo. Retorna `false` se for no-op.
* `explode(x,y,z,power,{ by?, breakBlocks=true })` — `permissions.can('explode')`; **autoridade** (solo/host) escava uma esfera (borda irregular, blocos duros resistem mais, plantas acima caem, TNT dentro vira TNT aceso com pavio curto = reação em cadeia) via `world.applyEdit(…,'game')` numa fila de 360/600/1100 blocos por quadro (potato/low/resto); depois faz `broadcast('combat:explosion', {x,y,z,power,by})`. **Guest**: envia `intent:explode` ao host. Todos os clientes tocam o efeito local: som, partículas, onda de choque, tremor, dano (`round(f²·power·3,4)`) e knockback no jogador e nos mobs próximos, empurrão em entidades soltas.
* `projectile({ kind:'arrow'|'snowball'|'pearl'|'rocket', x,y,z, dx,dy,dz, speed, damage, knockback })` — cria a entidade local e faz `broadcast('it:proj', …)` (cópias só visuais nos outros). O acerto é detectado por quem atirou (alvo = mobs locais + `ctx.net.players`, cápsula 0,76×1,8 a partir de `pos` = **pés**) e resolvido pela vítima via `combat:hit`.
* `prime(x,y,z,fuse,vx,vy,vz)` / `ignite(x,y,z)` — TNT aceso (entidade) / acende o bloco 51. Guests mandam `intent:tnt` / `intent:ignite`; a autoridade cria e faz `broadcast('it:tnt')` para as cópias visuais.
* Mensagens de rede (namespaces `it:` / `combat:` / `intent:`): `combat:hit`, `combat:explosion`, `it:proj`, `it:tnt`, `intent:explode`, `intent:tnt`, `intent:ignite`. Todas validadas (`typeof`, `clamp`, contagens limitadas) — dados de rede são não confiáveis. Sem `ctx.net` (ou antes de N carregar) tudo roda como solo/autoridade.

## Camada de entidades (`entities.js`)
Pool de ≤ 128 (flechas, bolas de neve, blocos em queda / arremessados, TNT aceso, drops, bloco da arma de gravidade, foguetes, pérolas) + 6 ondas de choque. Física AABB simples contra `world.getBlock`, colisão de projéteis por `world.raycast` por segmento (sem tunelamento), renderização **instanciada** com posição relativa à câmera (float64 → float32, como `Mobs`): 1 `InstancedMesh` colorido + 1 por id de bloco em uso. `update()` retorna imediatamente quando vazio.

## Mudanças em arquivos compartilhados
`game/Player.js` (`gravityScale`, `extraJumps`, `flyMode`, `speedMul`, `fallCap`, `accel` (aceleração externa de 1 quadro), `impulse()`), `game/Controls.js` (respeita `flyMode`, `noDoubleTapFly`), `game/Interaction.js` (`itemHook`, `breakMul`, `permit`/`onDenied` → permissões `break`/`place`, TNT: dureza 0,05), `game/Particles.js` (192 partículas, parâmetro de velocidade), `game/Audio.js` (sons de espada, arco, explosão, jetpack, gancho…), `render/Hand.js` (modelos de itens), `ui/ui.js` (ícones/rótulos de itens, `beginModal/endModal`, gancho do painel E), `main.js` (`setSlot`), `shared/blocks.js` (+ `B.TNT = 51`), `render/textures.js` (`tnt_top`, `tnt_side`).

## Limitações conhecidas
Mobs são locais a cada cliente (não replicados): dano a animais só vale no cliente de quem bateu. O bloco segurado pela arma de gravidade e o rastro do gancho não são replicados. Testado com dois navegadores reais em `LocalTransport` (host + visitante: golpe de espada → `combat:hit` → dano no visitante, explosão pedida pelo visitante → blocos removidos nos dois, TNT/flecha do host visíveis no visitante, morte visível no host) e com um `ctx.net` simulado (permissões, mensagens hostis). Props do `prop_gun` (caixa, barril, bola) são locais (não replicados).


## PvP: armas, destruição e movimento (rodada inline)
Todas as armas entram pelo mesmo caminho de dano (`ctx.combat`): o acerto em jogador é resolvido pela vítima (`combat:hit`, respeita `pvp`), a destruição de blocos roda na autoridade (`explode` / `applyEdit(...,'game')`, respeita `explode`/`break`). Fora do criativo cada arma gasta munição própria (`bullet`, `shell`, `missile_ammo`, `cell`, `grenade`, `mine`).

| id | nome | uso |
|---|---|---|
| `rifle` | Fuzil | segurar esq. = rajada (≈9 tiros/s, hitscan 3,2 de dano, ×2 na cabeça, espalhamento cresce com o calor) · dir. segurado = mira (zoom 2×, menos espalhamento) |
| `shotgun` | Escopeta | 8 projéteis em leque, 0,85 s de recarga, recuo que empurra você para trás |
| `rocket_launcher` | Lança-mísseis | míssil reto (sem gravidade, acelera) explode no impacto (raio 3,4): cratera + knockback — **rocket-jump** mirando no chão |
| `railgun` | Railgun | raio perfurante: atravessa todos os jogadores (13 de dano) e até 6 blocos de terreno; 1,6 s de recarga |
| `grenade` | Granada | esq. arremessa forte, dir. lança curto; quica, explode em 2,3 s (raio 3,2) |
| `mine` | Mina de proximidade | coloca no chão; arma em 1,2 s (a sua própria em 3 s) e explode quando alguém chega perto |
| `hammer` | Marreta de Demolição | esq.: golpe (9 de dano, empurrão forte) + cratera no bloco mirado · dir.: pancada no chão que te lança para cima |
| `harpoon` | Arpão | fisga jogadores/animais e os **puxa até você**; em bloco, puxa você |
| `glider` | Planador | segurar Espaço no ar: plana para a frente |

HUD: *hitmarker* no centro da mira em cada acerto (vermelho/maior em headshot ou abate) e som; números de dano flutuantes. Rastros (tracers) e minas são replicados (`it:beam`, `it:mine`, `it:mineoff`, `it:gren`); mísseis usam `it:proj` com `kind:'missile'`.

### Movimento (sempre ativo, não precisa de item) — `ctx.movement`
* **Dash** — `V` (ou botão ⚡): impulso de ~19 blocos/s na direção em que você anda (ou olha), 2 cargas que recarregam em 1,7 s; funciona no ar. Evento `player:dash`.
* **Wall-slide + wall-jump** — no ar encostado numa parede e andando para ela você desliza devagar; `Espaço` pula para longe da parede e **devolve uma carga de dash** (encadeie para subir/avançar rápido).
* **Ground-pound** — agachar (`C`/Ctrl) a mais de ~2 blocos do chão mergulha; ao cair faz onda de choque + cratera pequena (`noSelf`: não machuca você; derruba e machuca quem está perto) e cancela o dano de queda. Evento `player:slam`.
* Combina com **Jetpack, Gancho, Arpão, Planador, Pena e Botas** (todos já existem).

API nova: `combat.hitscan(opts)`, `combat.beam(...)`, `combat.grenade(...)`, `combat.placeMine(...)`, `combat.explode(x,y,z,power,{by, noSelf})`, `hud.hitmarker(kill, head)`, `player.fovExtra/fovMul`.
