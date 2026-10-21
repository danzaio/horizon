# HORIZON — memória viva do projeto

> Arquivo de memória. Eu (orquestrador) releio no começo de cada rodada e atualizo no fim.
> Última atualização: 2026-10-21 21:32 UTC (4 agentes concluídos e integrados; armas PvP/movimento prontos; push GitHub aguardando acesso do app Claude).

## Visão (palavras do usuário)
"No Man's Sky + Minecraft, online, rápido, fluido. Cada pessoa tem seu próprio planeta/Minecraft e pode abrir aos outros ou fechar (domo).
Ferramentas fáceis para criar minigames, estilo Garry's Mod, tudo dentro do universo Minecraft."
Hospedagem estática (github.io), P2P, sem servidor nosso. Roda em hardware batata. Português BR no chat.

## Preferências do usuário
- Fala PT-BR informal. Respostas curtas, diretas, sem enrolação.
- Já deixou claro: **eu NÃO estou no PC dele** (sessão na nuvem). Para publicar: comandos PowerShell ou ele cria o repo vazio e eu uso `add_repo`.
- Subagentes Sonnet 5.5 liberados (até 4 em paralelo). Em rodadas de polish ele já pediu "inline sem subagents" — respeitar o que ele disser por último.
- Quer mostrar para um amigo → link público (github.io). Quick tunnel é impossível neste sandbox (host trycloudflare bloqueado).
- Pediu: "vai sempre lendo e atualizando memória" → manter este arquivo + `CLAUDE.md` em dia.

## Estado do projeto
- Engine voxel Three.js 0.186 / Vite, chunks 32×32×192, mesher greedy em workers, LOD quadtree (níveis 1–9), shaders (SSAO, SSR, nuvens, aurora, TAA, shafts, DOF…), presets potato→ultra + AutoQuality. Tudo testado em SwiftShader (sem GPU → sem FPS real).
- Arquitetura de plugins (pronta, testada): `src/features/{events,registry,identity,permissions}.js`, features em `src/features/<nome>/index.js` (glob), contrato em `docs/CONTRACT2.md` (vinculante), rede em `docs/NET.md`.
- Hotkeys reservados: E inventário, G ferramentas, J galáxia, U universo, O online, N rede, Y/M minigames.
- Block ids: G 51–69, M 70–89.

## Agentes em andamento (iniciados ~20:10, parada 21:45 UTC)
| Agente | Pasta | Estado às 20:40 |
|---|---|---|
| U Universe | `src/features/universe/` | **CONCLUÍDO** (ver seção U abaixo) |
| N Net | `src/features/net/` + `docs/NET.md` | **CONCLUÍDO** (ver seção N abaixo) |
| G Items | `src/features/items/` | **CONCLUÍDO** (ver seção G abaixo; docs/ITEMS.md) |
| M Minigame | `src/features/minigame/` | **CONCLUÍDO** (ver seção M abaixo; docs/MINIGAMES.md) |

Arquivos compartilhados que os agentes mexeram (revisar na integração): `shared/blocks.js`, `ui/ui.js`, `world/{mesher,terrain,chunk.worker,World,lodMesher,chunkGen}.js`, `game/{Controls,Interaction,Player,Particles,Audio}.js`.

## Checklist de integração (fazer quando os 4 terminarem)
1. Ler os 4 relatórios finais; anotar divergências do CONTRACT2.
2. `npm run build` + single-file build; zero erros no console.
3. Teste de aceitação CONTRACT2 §5 (headless: 2 abas, BroadcastChannel LocalTransport).
4. Soak/screenshot em potato/medium/ultra (regressão de perf do engine; terreno legado `profile:null` deve ficar idêntico).
5. Conferir ids de bloco (sem colisão), hotkeys, Esc fecha painéis, ponteiro trava/destrava.
6. Atualizar README (recursos novos, controles) e regenerar `/home/user/horizon-projeto.zip` + `/home/user/horizon-jogo.html`.
7. Republicar Artifact (avisar: WebRTC não funciona dentro do Artifact, só no github.io).
8. Publicar no GitHub (ver abaixo).

## Publicação GitHub (pendente)
- Bloqueado: criar repo via API/GraphQL não funciona nesta sessão; só repos já existentes via `add_repo`.
- Entregues ao usuário: comandos PowerShell (`gh repo create horizon --public --source=. --push` + Pages por Actions) e opção B (ele cria repo vazio, confirma acesso do app em claude.ai/connect-github, eu faço push).
- Quando o repo existir: `add_repo(owner, repo, access: push)` → clonar → copiar projeto → commit (sem identificador de modelo na mensagem) → push → `gh api -X POST repos/OWNER/horizon/pages -f build_type=workflow` → conferir `https://OWNER.github.io/horizon/`.
- Workflow: `.github/workflows/pages.yml` (build + deploy).

## Fatos do ambiente (não esquecer)
- Só WebGL por software (SwiftShader). Static servers morrem quando o ambiente reinicia → `scripts/serve.sh <dir> <porta>`.
- Scratchpad: `/tmp/claude-0/-home-user/909ae463-6711-55a8-ad26-4029f138c696/scratchpad/`.
- Não é repositório git local. Entregáveis em `/home/user/`: `horizon-projeto.zip`, `horizon-jogo.html`, PNGs de showcase.
- Hard stop dos agentes: 21:45 UTC. Data de hoje: 2026-10-21.

## Backlog (oferecido, não começado)
Guia de arquitetura/entrevista, vista X-ray, modo benchmark, gravador cinematográfico, merge de draw calls dos LODs, LICENSE (decisão do usuário).

## Log
- 20:10 — plumbing pronto, 4 agentes lançados.
- 20:15 — respondi ao usuário sobre GitHub (PowerShell / opção B).
- 20:36 — usuário pediu memória viva → criado `docs/MEMORY.md` e `CLAUDE.md`.
- 20:58 — relatório de U recebido e registrado (agentes N, G, M ainda rodando).

## U (Universe) — relatório final recebido
- Endereços `XXXX-XXXX-XXXX` (Crockford b32: 6b galáxia, 18b sx, 18b sy, 3b planeta, misturador bijetivo, checksum 15b). Teste: 20k round-trips, 0 colisões, 100% dos erros de 1 caractere rejeitados.
- Gerador: sistemas com estrela e 3–7 planetas; 8 tipos (verdant, lush, desert, frozen, volcanic, ocean, alien, barren); perfil ≈600 B JSON (`docs/PLANETS.md`). `homeAddress(id)` determinístico → sempre verdant/lush.
- `profile:null` = mundo antigo **idêntico bit a bit** (27 amostras de chunk/mesh/LOD).
- Perfil flui por `createTerrain(seed, profile)`, `ChunkGen`, `LodMesher`, worker; tint por planeta (`makeTintTable`); `World` sanitiza perfil (pode vir de host remoto). Novo `world/profile.js`.
- Renderer: `gr.setPlanetLook` (céu, 2º sol, luas, estrelas, aurora, nuvens, neblina, água, duração do dia). Volcanic = mar de magma emissivo + dano via `ctx.health.damage`. Gravidade por `player.gravityScale` (barren 0.48).
- Feature order 10: `resolvePlanet`, `ctx.universe`, badge, `visited` persistido; botão de menu "Meu endereço no universo".
- Mapa da galáxia (J / 🪐): pan/zoom, minimapa espiral, ir-para-endereço, órbitas, "Viajar" = hiperespaço 1.2s → recarrega com `?planet=ADDR` (só `ctx.role==='solo'`).
- Domo (`dome.js`): casca hex raio 48, 1 draw call, off em potato, segue `ctx.dome.mode` / `dome:change`. **Só testado setando `ctx.dome.mode` à mão — integrar com N.**
- Desvios: `?autostart=1` sem `?planet` continua o mundo antigo (scripts de teste intactos); quem tem save legacy continua nele; `terrain.js` exporta `setDefaultProfile` (World registra).
- Arquivos tocados fora da pasta: `world/{terrain,chunkGen,lodMesher,chunk.worker,World,mesher}.js`, `render/{TimeOfDay,GameRenderer}.js`, `render/shaders/{sky,common,water,lod}.js`, `world/profile.js`.
- **Pendências U:** ilhas flutuantes e tabelas flora/fauna por tipo (mobs só em grama → nenhum em volcanic/barren); N deve passar `planet` (com `profile`) inteiro aos convidados (`resolvePlanet` não roda em guest); spawn aleatório pode cair em neve num verdant (`findSpawn` do main.js); slider de duração do dia sobrescreve a do planeta; água LOD volcânica não é emissiva à noite.
- Ferramentas de teste: scratchpad `u/{pshots,smoke,identity,maptest}.mjs`.

## Itens de integração herdados (somar ao checklist)
- N passa `planet` + `profile` verbatim ao guest; conectar `dome:change`/`ctx.dome` (N) ↔ `dome.js` (U).
- Mobs em planetas sem grama (volcanic/barren/alien/ocean): decidir tabela por tipo (inline, pequena).
- `findSpawn` respeitar bioma/planeta.
- 21:05 — findSpawn (main.js) agora evita neve/gelo em planetas com perfil não-frozen (legado `profile:null` inalterado). Pendente: mobs por tipo de planeta.

## G (Items/Health/Combat) — relatório final recebido
- Docs: `docs/ITEMS.md` (controles novos). Código: `src/features/items/`.
- `ctx.items/inventory/health/combat` conforme CONTRACT2 §3. Hotbar guarda number|string|null (salvo via Save.js). 21 itens (painel E; abas Blocos/Ferramentas/Armas/Especiais/Minigame; busca; arrastar p/ slot): espada, arco+flecha, TNT (item + bloco id 51), isqueiro, gravity gun, jetpack, grapple, bola de neve, varinha, picareta, machado, fogos, pérola, pena, botas, escudo, maçã, build wand, tinta, prop gun (caixa/barril/bola físicos).
- Vida: 10 corações, flash/shake de dano, queda/afogar/lava/void, tela de morte "Renascer" (Enter), 3s invulnerável, `localState.hp`, eventos `player:damage/die/respawn`, números de dano, kill feed, drops de mobs.
- Explosões: esfera via `applyEdit(...,'game')` com orçamento por frame, cadeia, knockback, shake; pool de 128 entidades = 0.37 ms/frame. Idle 0.001–0.004 ms/frame.
- Rede testada com 2 páginas reais via LocalTransport (golpe→dano no guest, explode intent→host carve→edit chega ao guest, TNT/flecha visíveis no guest).
- Passou: `npm run build`, single-file, `Player.test.mjs` (7), `AutoQuality.test.mjs` (10).
- Desvios: handlers internos (S, st, inp); `ctx.items.register` usa `use(ctx, hand, S, st, inp)`; `combat.projectile` recebe options; novo `ctx.itemsRuntime` (interno). Player ganhou gravityScale, extraJumps, flyMode, speedMul, fallCap, accel, impulse(); permissão 'fly' → `player.flyMode`; Interaction agora chama `permissions.can('break'|'place')`.
- Jogadores remotos assumidos com pos = pés. Mobs, props, gravity-gun block e corda são **locais** (não replicados).
- Sem precompile de shader de itens (hitch pequeno no primeiro uso). Vite HMR recarrega a página quando qualquer agente salva (testar com build estático).
- Arquivos tocados fora da pasta: `shared/blocks.js` (+TNT 51), `render/textures.js`, `game/{Player,Controls,Interaction,Particles,Audio}.js`, `render/Hand.js`, `ui/ui.js` (itemRenderer, beginModal/endModal, palette hooks), `main.js` (setSlot), `index.html`.
- 21:01 — relatório de G recebido e registrado (restam N e M).

## M (Minigame toolkit) — relatório final recebido
- Docs: `docs/MINIGAMES.md`. Zero edições em arquivos compartilhados (CSS importado da própria pasta; blocos 70–89 não usados).
- GameDef v1 (JSON): meta, 13 tipos de entidade (spawn, goal, checkpoint, killzone, trigger, pad, itemGiver, button, door, sign, flag, zone, area), regras com 12 eventos × 8 condições × 21 ações (enums fechados), loadout, vars, win, arena ops. Validador estrito + limites duros (entidades ≤300, regras ≤200, ações/tick ≤64, blocos/tick ≤2000 [500 potato], texto ≤120). Sem eval/innerHTML.
- Código de compartilhar: `HZG1.<deflate-raw b64url>.<crc32>` (+ link `?game=`, JSON cru), ~1.2–3 KB por template; seguro contra bomb/tamper.
- Runtime só na autoridade (solo/host), 15 Hz, zero trabalho ocioso; placar, vidas/eliminação/espectador, voltas+checkpoints, CTF, rei do morro, pega-pega, TNT crumble, portas, timers.
- Replicação: `mg:start` (também em `registerSnapshot('mg')` e `net:peerJoin`), `mg:state` ≤5 Hz, `mg:fx`, `mg:stop`; autoridade ignora `mg:*` de peers. Lobby + "Começar" no menu Y.
- Editor (Y/🎮): dock translúcido, adicionar na mira, seleção por raio/Q, props, nudge + numpad, duplicar/apagar, undo/redo, builder QUANDO/SE/ENTÃO, testar agora, salvar/abrir/novo, exportar/importar/copiar/link/.json. 8 templates: Parkour, Spleef, TNT Run, Corrida, Capture a Bandeira, Rei do Morro, Pega-Pega, Último de Pé.
- Testes: `node src/features/minigame/minigame.test.mjs` (25 ok), `dev/replication.mjs` (precisa dev server). Playwright potato/low desktop+touch: 8 templates chegam a running sem erro; build passa.
- Desvios/pendências: sem WebRTC real (só net fake); killzone respawna por teleporte (sem tela de morte do G); botões são placas de pressão; editor precisa soltar o ponteiro p/ clicar (ou Q/numpad/Del); Pega-Pega precisa 2+ jogadores; loadouts ignorados sem itens; arenas ficam no mundo após o jogo (sobrescritas na próxima rodada).
- Integrar: killzone → usar `ctx.health.damage`/respawn do G; checar com N real.
- 21:04 — relatório de M recebido e registrado (resta só N).
- 21:06 — Mobs em volcanic/barren: sem grama (GRAVEL) → MobAI já não spawna; desert sem entrada na tabela → idem. Decisão: aceitável, sem mudança.

## N (Net) — relatório final recebido
- Docs: `docs/NET.md`. Topologia estrela, host-autoritativo, máx 8. `ctx.net`/`ctx.dome` existem até em solo (objeto único, `role` muda; `ctx.role` segue via `net:role`).
- Transportes: WebRTC DataChannel (só STUN, sem TURN; UI avisa) e `LocalTransport` (BroadcastChannel). Sinalização: códigos manuais com QR (convite 107 chars, resposta 102, CRC16), código de sala curto + link `?join=`, Trystero (**nunca rodou contra relays reais**).
- Domo closed/open/invite com tokens de uso único, permissões no host e no guest, kick, chat (overlay + Enter), avatares com interpolação, sync de hora/clima. Botão de menu "Entrar em um planeta"; tecla O e 🌐; linha F3 com tráfego/ping. Sem WebRTC/BroadcastChannel (Artifact) → botões desativados com explicação.
- Extras: reconexão automática por código de sala (3 tentativas, host guarda id 90s), câmera 👁 seguir jogador, timer p/ aba escondida.
- Testes: `node scripts/nettest.mjs` (96 checks; variantes local BroadcastChannel e rtc loopback com códigos manuais), `node scripts/nettest-unit.mjs` (26). Rodar contra snapshot buildado (`vite build --outDir X` + servidor estático), não contra dev server (HMR atrapalha).
- Desvios: edits em lotes `eb` (não `edit` unitário); `dome.set('closed')` também expulsa quem está dentro; API extra `chat, leave, newInvite, newManualInvite, hostInfo, spectate` e eventos `net:chat/stats/hostInfo/closed/reconnecting`, `dome:perms`.
- Arquivos fora da pasta: `package.json`/`package-lock.json` (trystero@0.26, qrcode-generator@2), `scripts/nettest*.mjs`. Single-file build inlina Trystero (1.45 MB).
- Pendências/limites: Trystero não testado; só Chromium; sem TURN (NAT simétrico/CGNAT falha); guests por código manual não reconectam sozinhos; mobs (MobAI) não replicados; Esc no chat sai do pointer lock; 1 check e2e ("rtc: far edit reaches guest overlay") falhou em 2/6 runs (flaky em CPU disputada).
- Dev server do N na porta 5302 pode ainda estar rodando → matar.
- 21:10 — relatório de N recebido; todos os 4 agentes concluídos. Iniciada a integração (task #13).
- 21:20 — Integração: build ok; unit tests (address, generator, minigame 25, nettest-unit 26, Player 7, AutoQuality 10) ok; nettest 96/96 ok; accept host(volcanic)+guest 9/9 (perfil, gravidade, terreno idêntico, dome→guest, items/mg APIs, 0 erros). Corrigido: etiqueta de nome do avatar gigante de perto (avatars.js TAG_VS min 0.25).
- 21:30 — Screenshots OK: menu desktop/mobile (botões 'Entrar em um planeta' e 'Meu endereço no universo'), painéis E/Y/J/O, planeta alien. Detalhe pendente: bloco na mão (Hand.js) usa tint de grama fixo, não o do planeta.
- 21:40 — **Usuário: 'segue sempre 100% inline sem subagents'** (vale daqui pra frente; não lançar agentes). Soak potato/medium limpo; Hand.setPlanetTint adicionado (bloco na mão com tint do planeta).
- 21:41 — **Novo pedido do usuário:** 'add armas, destruição, etc pra ter um pvp legal, movimentação dashes hooks etc'. Plano: estender `src/features/items/` (armas hitscan/foguete/granada/mina, dash, wall-jump/slide, grapple melhor, destruição), tudo inline.
- 22:20 — **Armas PvP/destruição/movimento prontos** (inline): rifle, shotgun, rocket_launcher, railgun, grenade, mine, hammer, harpoon, glider + dash (V/⚡), wall-slide/jump, ground-pound; hitmarker; tracers/minas replicados. Testes headless OK (hitscan vs jogador falso: corpo 5 / cabeça 10 / escopeta soma 8 pelotas; explosão remove blocos; granada/mina detonam; pound sem dano de queda; 2 navegadores: explosão do convidado fere o host, noSelf poupa o autor, beam e mina replicam). Docs em ITEMS.md.
- 22:25 — **GitHub:** repo `danzaio/horizon` existe (usuário subiu versão antiga). `add_repo` ok, clone em `/home/user/horizon-gh`, mas **push → 403: o app Claude não tem acesso ao repo**. Commit local pronto em horizon-gh (89 arquivos). Precisa: instalar Claude GitHub App em https://github.com/apps/claude/installations/select_target (dar acesso a danzaio/horizon) — ou o usuário roda os comandos PowerShell/zip. Usuário quer o site https://danzaio.github.io/horizon/ sempre atualizado → a cada rodada: sincronizar horizon-gh (tar sem node_modules/dist), commit, push.
- Ideia pendente: template de minigame 'Deathmatch' (kills) usando `player:die`; mísseis/granadas não replicam dono em mobs; mobs ainda locais.
- 21:32 — Checkpoint agendado executado: agentes já terminaram, build ok, memória atualizada. (Horários anteriores do log 22:xx estavam adiantados; relógio real ≈ 21:3x UTC.)
- 21:38 — **Push OK** (acesso do app liberado): commit 5605263 em danzaio/horizon main; workflow build-and-deploy concluído com sucesso → https://danzaio.github.io/horizon/ . Sandbox não alcança github.io (proxy 403) — não dá para verificar a URL daqui, só o status do workflow (gh run list funciona; gh api pages não). Fluxo por rodada: tar do projeto → /home/user/horizon-gh (git user Claude <noreply@anthropic.com>) → commit → push.
- 21:55 — **Naves espaciais** (`src/features/ships/`): B chama/embarca/sai, Z câmera 1ª/3ª pessoa, WASD+Espaço/C+Shift turbo, laser (esq) e míssil (dir), colisão com voxels, órbita (y>200) → J abre mapa/salto de dobra, chegada pós-salto já embarcado; naves de outros jogadores replicadas (`ship:s`). **Online:** rendezvous agora Nostr+Torrent+MQTT simultâneos + TURN público de fallback (`transport.js` TURN_SERVERS); painel mostra relays conectados; botão "🔗 Convidar um amigo" (abre domo + copia link). Bug de Esc/mouse corrigido (clique recaptura). Usuário relatou que o online "não funcionou" na 1ª tentativa (provável: amigo sem convite/versão antiga) — pediu link simples, teleporte até o amigo, **mesma nave (piloto + artilheiro)** e **modo horda de monstros (estilo Helldivers 2)**. Plano: (1) link 1-clique + tp + status de entrada; (2) assento de artilheiro; (3) feature `horde/` (ondas, monstros no ctx.horde, alvo para hitscan/explosões, replicação `hd:s`/`hd:hit`).
