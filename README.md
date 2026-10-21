# HORIZON

> **Demo ao vivo:** https://danzaio.github.io/horizon/ (publicada pelo workflow `.github/workflows/pages.yml` a cada push na `main`)

Um mundo de blocos estilo Minecraft em **Three.js (WebGL2)** com **distância de visão praticamente infinita** — LOD no estilo *Distant Horizons* — pensado para rodar até em hardware fraco (GPU integrada, celulares antigos).
Tudo é procedural: **nenhuma textura, fonte ou áudio externo**; funciona offline.

## Bônus: Guitar Briga III — Lendas do Planalto (`/luta/`)

Jogo de luta satírico entre caricaturas do Lula e do Flávio, no estilo de *Guitar Hero III: Legends of Rock*: luta em **3D com Three.js** (toon shading em 3 tons, hachura de nanquim no shader, contorno por casco invertido, palco com treliças, amplificadores, bateria, feixes de luz volumétricos, plateia e o Congresso ao fundo) e telas de título/VS em **ilustração 2D**, como as telas de loading do GH3. Música e efeitos 100% procedurais (WebAudio). É paródia, só um jogo.

* `npm run dev` → http://localhost:5173/luta/ (no build: `dist/luta/index.html`, publicado junto no GitHub Pages).
* **1 jogador** (contra a CPU) ou **2 jogadores** no mesmo teclado; controles de toque no celular.
* Melhor de 3 rounds, 99 s. Bater/apanhar enche o **star power**: ¼ libera um especial, cheio libera o **SOLO** — um mini Guitar Hero de 3 trilhas (F/G/H) em que cada nota acertada solta um raio no adversário.

| Ação | J1 | J2 |
|---|---|---|
| Andar / pular / agachar | `A` `D` / `W` / `S` | setas |
| Defender | segurar para trás (agachado defende golpes baixos) | idem |
| Soco · Chute · Golpe pesado | `F` · `G` · `H` | `J` · `K` · `L` (ou Numpad 1-3) |
| Especial · Especial 2 | `R` · `S`+`R` | `U` · `↓`+`U` (ou Numpad 4) |
| Solo | `T` | `I` (ou Numpad 5) |
| Pausa · Som | `Esc` · `M` | |

| | Lula "O Barba" | Flávio "Zero Um" |
|---|---|---|
| Especial | **Foice e Martelo** (emblema giratório) | **Bola Zero Um** |
| Especial 2 | **Libera o Sigilo!** (balão que atordoa e espalha extratos bancários) | **E o Lulinha?** (balão que deixa o Lula tonto: "MUDOU DE ASSUNTO!") |
| Pesado | **Martelada** | **Guitarrada** |
| Super | Solo do Companheiro | Solo Zero Um |

**Participações especiais** (eventos aleatórios no meio do round, valem para os dois): o **Zé Gotinha** entra correndo e deixa uma vacina (+15 de vida para quem pegar); o **Vorcaro** atravessa o palco com a maleta jogando "CDB a 140% do CDI" (cada nota dá star power) até o "BANCO MASTER: LIQUIDADO!" queimar o que sobrou. E um pato amarelo gigante inflável flutua atrás do palco. A CPU também corre atrás dos itens.

Código em `luta/`: `src/main.js` (lógica, IA, solo, HUD, telas 2D, áudio), `src/three/stage.js` (palco, câmera de luta, luzes, plateia, projéteis), `src/three/rocker.js` (personagens 3D montados com primitivas e texturas pintadas em canvas, guiados pelos mesmos ângulos de pose da lógica; IK nos braços durante o solo), `src/three/toon.js` (materiais toon + hachura + contorno), `src/three/extras.js` (Zé Gotinha, vacina, Vorcaro, pato). Para testes: `?scene=title|mode|select|vs|fight|result&mode=1|2&mute=1` e `window.__gb` (`game`, `step(n)`, `startSolo`, `r3`).

## Rodar

```bash
npm i
npm run dev        # http://localhost:5173
npm run build      # build de produção em dist/ (workers incluídos)
npm run preview
npx vite build -c vite.single.config.js   # UM único HTML autossuficiente em dist-single/index.html (JS, CSS e workers inline)
node scripts/tour.mjs http://localhost:4173 ./shots   # tour de integração headless (screenshots em vários horários/qualidades)
node src/game/AutoQuality.test.mjs   # testes da qualidade automática
node src/game/Player.test.mjs        # testes de física/colisão do jogador
```

Parâmetros de URL (testes / compartilhar): `?seed=N&quality=potato|low|medium|high|ultra|auto&autostart=1&time=HH.H&x=&y=&z=&yaw=&pitch=&fly=1&touch=1&notouch=1`
`hud=0` esconde o HUD (screenshots limpos). `?mock=1` (ou `mock=world` / `mock=render`) troca World/GameRenderer por simulações leves em `src/game/dev/`.
Para automação existe `window.__hz` (`ready`, `world`, `gameRenderer`, `player`, `camera`, `setQuality`, `teleport`, `lookAt`, `setTime`, `screenshotReady`, `stats`).

## Controles

> **Sem captura de mouse** (ex.: página dentro de um iframe sandboxed): o jogo detecta a recusa do *pointer lock* e muda sozinho para o **modo arrastar** — arraste com o botão esquerdo para olhar, segure parado para quebrar, toque rápido ou botão direito para colocar.

| Ação | Teclado / mouse | Toque |
|---|---|---|
| Mover | `W A S D` | joystick esquerdo (empurre ao máximo = correr) |
| Olhar | mouse (captura o ponteiro ao clicar) | arrastar o lado direito |
| Pular / nadar para cima | `Espaço` | ▲ |
| Correr | `Shift` | joystick no limite |
| Agachar / descer (voo, água) | `Ctrl` ou `C` | ▼ |
| Voar | `F` ou toque duplo em `Espaço` (`Shift` = turbo; `Shift`+roda = velocidade) | ✈ |
| Quebrar (segurar) | botão esquerdo | ⛏ |
| Colocar | botão direito | ▣ |
| Pegar bloco | botão do meio | — |
| Hotbar | `1`–`9` / roda | toque nos slots |
| Paleta de blocos | `E` | ▦ |
| Hora do dia | `T` | — |
| Lanterna (luz na mão) | `L` | — |
| Clima (limpo → chuva → tempestade → neve) | `K` | — |
| Modo foto (profundidade de campo no que está sob a mira; `[` `]` mudam a abertura) | `P` | — |
| Debug | `F3` | — |
| Captura de tela | `F2` | menu de pausa |
| Mudo | `M` | — |
| Pausa / configurações | `Esc` | ☰ |

Configurações (qualidade com *Auto*, distância de visão, FOV, sensibilidade, volume, velocidade do tempo, FPS) ficam salvas em `localStorage`.

## Arquitetura

```
src/
  shared/   constants.js  blocks.js  quality.js     registro de blocos, presets, formatos (sem THREE: usado também nos workers)
  world/    World.js  terrain.js  mesher.js  lodMesher.js  chunk.worker.js  WorkerPool.js   terreno, malhas, LOD, streaming
  render/   GameRenderer.js  materials.js  shaders/  Sky.js  ShadowPass.js  PostFX.js  textures.js   shaders, céu, sombras, pós-processamento
  game/     Player.js  Controls.js  Interaction.js  AutoQuality.js  Audio.js  Particles.js  dev/   jogador, entrada, interação, qualidade adaptativa
  ui/       ui.js  icons.js  title.js  settings.js  style.css   menus, HUD, debug
  main.js                                            cola tudo (menu → carregamento → jogo)
```

* **Mundo determinístico**: `terrain(seed)` são funções puras; as edições do jogador ficam numa camada esparsa (por chunk) reaplicada pelos workers. A thread principal só mantém voxels de poucos chunks ao redor (colisão, raycast, edição).
* **Chunks (LOD 0)**: 32×32×192, malha *greedy* feita em **workers**, com **vértices empacotados** (`aPos` Uint16 em 1/16 de bloco + camada de textura, `aMeta` Uint8 com face/AO/flags/luz, `aTint` Uint8 normalizado). Buffers viajam por *transfer*.
* **LOD**: um *quadtree* de tiles (nível *L* = células de 2^L blocos, 32×32 células por tile, até 16 km) amostrados das mesmas funções do terreno, em colunas "escalonadas" com **saias** nas bordas para esconder rachaduras; o pai grosso só some quando todos os filhos finos estão prontos (sem buracos). Floresta/neve/penhasco são sinalizados por flags e reaparecem por shader.
* **Shaders**: materiais `solid`, `water`, `lodSolid`, `lodWater` compartilham uma mesma névoa (perspectiva aérea que casa com o céu), texture-array procedural 16×16, AO por vértice, luz do céu/blocos, sombras, vento, céu/nuvens/sol/lua/estrelas, ciclo dia-noite e pós-processamento opcionais conforme o preset.
* **Qualidade automática** (`AutoQuality.js`): média móvel + p95 do tempo de quadro em janelas de 2 s. p95 > 1,25× o alvo (16,7 ms) em 2 janelas seguidas ⇒ degrada (escala de render 1 → 0,85 → 0,7 → 0,55 → 0,4, depois um preset abaixo com 0,85); p95 < 0,7× por 10 s ⇒ sobe. Histerese ≥ 8 s, *backoff* contra oscilação, ignora aquecimento, aba oculta e carregamento. Chute inicial por `hardwareConcurrency`, `deviceMemory`, celular e string da GPU (SwiftShader/llvmpipe ⇒ *batata*).
* **Pipeline gráfico por tier** (`PostFX.js`, tudo opcional e desligável pelo menu *Efeitos avançados*):
  * **Água (high/ultra)**: o mundo opaco é desenhado primeiro, a cor+profundidade são copiadas e só então a água é desenhada lendo essa cópia — **refração**, **absorção de Beer–Lambert pela espessura real**, **SSR** (marcha em espaço de tela com fallback para o céu) e espuma de margem. Água e overlay (chuva, mão) ficam em *layers* próprios.
  * **SSAO** (meia resolução, normais da profundidade, blur bilateral), **TAA** (jitter Halton + reprojeção por profundidade + clamp de vizinhança; a mão não reprojeta), **feixes de luz volumétricos** (marcha pelo shadow map real, fase Henyey–Greenstein), **bloom** dual-filter, **exposição automática** (luminância na GPU, sem readback), **lens flare** com oclusão por profundidade, aberração cromática, grão e **motion blur** de câmera (ultra).
  * **Superfície**: relevo "pixel bump" derivado da luminância da textura, translucência de folhas contra o sol, reflexo do céu em superfícies molhadas, **caustics** no fundo da água, neve que se acumula nas faces superiores durante nevascas, sombras de nuvens no terreno e no LOD, hill-shade nos tiles de LOD suaves.
  * **Cor**: o tint do bioma recebe variação suave de luminância e matiz por posição de mundo, gravada **na própria malha** (custo zero no runtime) e reproduzida igual nos tiles de LOD — campos e copas deixam de ser uma mancha uniforme.
  * **Bruma** de amanhecer/entardecer acumulada nos vales (densidade de névoa por hora do dia).
  * **Modo foto** (`P`): HUD e mão escondidos, DOF com foco automático no que está sob a mira.
  * **Céu**: nuvens volumétricas por *ray-march* de campo de altura (ultra), aurora boreal à noite, estrelas, lua, atmosfera analítica.
* **Clima** (`Precip.js` + `uWeather`): chuva (riscos) e neve (flocos) animadas inteiramente no vertex shader, num campo repetido ao redor da câmera (zero trabalho de CPU por partícula); céu cinza, névoa mais densa, sol fraco, superfícies molhadas e relâmpagos com trovão. Ciclo automático por bioma (neve em biomas frios, deserto seco); `?weather=rain|storm|snow|clear` força.
* **Vida**: vaga-lumes à noite e pétalas no bosque de cerejeiras (mesma infraestrutura GPU); **animais** (porco, vaca, ovelha, galinha) em `InstancedMesh` — 1 draw call por espécie, pernas e cabeça animadas no vertex shader, IA simples na CPU (`MobAI.js`: passear, pastar, fugir, degraus, penhascos, água) com limite por qualidade.
* **Luz na mão**: lanterna quente que acompanha a câmera (cavernas e noite; quase invisível de dia; glowstone na mão ilumina mais); bloco na mão com balanço, soco e troca animados (`Hand.js`).
* **Transições**: chunks/tiles que refinam um pai mais grosso entram por *dither fade* (o pai fica por baixo até o fim), sem buracos nem pop-in seco.
* **Estruturas e vida**: **vilas** procedurais (grade de 224 blocos; sítio plano em bioma habitável; casas com cantos de tronco, janelas, telhado inclinado, tochas por dentro, poço, fardos de feno e caminhos que seguem o terreno; a pedra e o material mudam por bioma) — a geração é recortada por chunk e idêntica dos dois lados de cada borda. No mar: **recifes de coral** em águas quentes, **florestas de kelp** em águas frias e campos de **capim-marinho**; essas plantas são tratadas como "alagadas" (a malha de água as ignora e o jogador nada normalmente através delas). **Tocha** emissiva que ilumina por flood-fill.
* **Salvamento** (`Save.js`): construções (camada de edições do mundo), posição, direção, hora e hotbar por semente em `localStorage`, com autosave a cada ~8 s quando algo mudou e ao esconder a aba; "Apagar mundo salvo" no menu de pausa. Em modo `?autostart=1` só salva com `&save=1`.
* **Arco-íris** depois que a chuva forte passa com o sol baixo; tratamento de perda de contexto WebGL (salva e pede recarga).
* **Biomas**: 16 (incl. bosque de cerejeiras e *badlands* com mesas e estratos de terracota).
* **Jogador** (`Player.js`): AABB 0,6×1,8 com varredura por eixo em sub-passos ≤ 0,4 bloco (sem atravessar paredes a 60+ blocos/s); fica congelado enquanto a coluna sob ele não foi carregada.
* **Áudio** (`Audio.js`): WebAudio 100% procedural (passos por superfície, quebrar/colocar, splash, vento por altitude, grilos/pad à noite).

## Desempenho

* Sem alocações por quadro nos caminhos quentes do jogo (jogador, entrada, partículas, interação).
* Geração/malhagem em workers; upload de malhas com orçamento de ms por quadro (`meshUploadMs` do preset).
* Resolução dinâmica (`renderScale`) e presets *Batata → Ultra* controlam sombras, pós-processamento, nuvens, água, distância e raio de chunks.
* Teste visual headless: `node scripts/shot.mjs "http://localhost:5173/?autostart=1&quality=low" out.png --ready="window.__hz && window.__hz.ready"`.
