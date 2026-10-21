# HORIZON — Multijogador P2P (feature `net`, agente N)

Sem servidor nosso: o dono do planeta é o **anfitrião** (host); visitantes (guests) conectam **só ao anfitrião** (topologia em estrela, máx. 8 jogadores).
Tudo vive em `src/features/net/**`. Teste automatizado: `node scripts/nettest.mjs` (ver §9).

## 1. O que existe

| Arquivo | Papel |
|---|---|
| `protocol.js` | versão do protocolo, limites, sanitizadores (nome, texto, cor, planeta…), token bucket (rate limit), códigos de sala |
| `transport.js` | `Transport` (reliable + unreliable; eventos `open/close/message`), `LocalTransport` (BroadcastChannel), `RtcTransport` (WebRTC DataChannel), `Link` (JSON + fragmentação de mensagens grandes + contadores) |
| `signal.js` | Sinalizadores: **manual** (códigos de convite/resposta + QR), **Local** (lobby BroadcastChannel), **Trystero** (relays públicos) |
| `net.js` | `Net` = `ctx.net`: papéis solo/host/guest, handshake, relay, chat, kick, ping, domo, estatísticas |
| `sync.js` | cola com o jogo: edições de blocos, permissões (`ctx.permissions`), hora/clima, pose local |
| `remote.js` | `RemotePlayer` + interpolação de snapshots (≈110 ms de atraso, extrapolação curta) |
| `avatars.js` | avatares instanciados (corpo + etiquetas de nome = **2 draw calls**), shader leve com luz/neblina do motor |
| `follow.js` | espectar/seguir um jogador (câmera em 3ª pessoa) |
| `ui-join.js`, `ui-game.js`, `dom.js`, `net.css` | botão **Entrar em um planeta**, painel **O**, chat (overlay + Enter), linha de stats no F3 |

`ctx.net` e `ctx.dome` **existem sempre** depois do `init` (solo = o mesmo objeto em repouso: `role:'solo'`, `isAuthority:true`, `tick()` retorna na primeira linha).

## 2. Fluxos

**Anfitrião.** Jogue normalmente → `O` → escolha **Aberto** ou **Por convite** (`ctx.dome.set('open'|'invite')`, ou `ctx.net.startHosting({mode})`). O painel mostra o código de sala (`ABCD-EF12`), link (`?join=ABCD-EF12`) com QR, e o convite de uso único (`ABCD-EF12~K7Q9X2`) no modo convite.
**Fechado** (`dome.set('closed')` / `stopHosting()`) = para de aceitar conexões **e expulsa quem está dentro** (mensagem "O anfitrião fechou o domo").
**Visitante.** Menu → **Entrar em um planeta** → código (ou abrir o link) → `hello` → `welcome` → `api.startGame({planet, edits, net, role:'guest'})`. Visitantes nunca salvam localmente (`G.saveOn=false` para `role:'guest'`) e nascem ao lado do anfitrião (`ready` usa `welcome.pos`).
**Modo manual** (100 % sem servidor): anfitrião cria um *código de convite* (≈105–170 caracteres, medido: 107 em loopback) → visitante cola e recebe um *código de resposta* (≈100–160) → anfitrião cola a resposta → conecta sozinho. Ambos os códigos têm CRC16 (cópia truncada é detectada) e QR.
**Host saiu / expulsou / domo fechado**: o visitante recebe um painel claro e volta ao menu (o motor não troca de mundo "a quente").
**Queda de conexão**: quem entrou por *código de sala* reconecta sozinho (3 tentativas, 0,9/1,8/2,7 s) e retoma no mesmo lugar (o host guarda o id por 90 s e dispensa novo convite; o mundo recebe as edições de novo). Quedas curtas do WebRTC (`disconnected`) têm 9 s de graça antes de contar como queda. Convites **manuais** não reconectam (precisariam de códigos novos).
**Seguir/espectar**: botão 👁 na lista de jogadores (`net.spectate.start(id)`): câmera em 3ª pessoa atrás do jogador; Esc/WASD/Espaço/Enter encerram.

## 3. Transportes e sinalização

* **WebRTC DataChannel** com dois canais *pré-negociados* (sem `ondatachannel`): `id 0` confiável+ordenado, `id 1` `ordered:false, maxRetransmits:0` (posições). Só **STUN** (`stun.l.google.com:19302`, `stun.cloudflare.com:3478`); **sem TURN**: **algumas redes (CGNAT, Wi‑Fi corporativo, alguns 4G, NAT simétrico) não conseguem conectar** e não há como contornar sem um servidor de retransmissão. A UI avisa isso. Instabilidade curta (`disconnected`) tem 9 s de graça antes de cair.
* **LocalTransport** (`BroadcastChannel`): abas do mesmo navegador/origem; usado pelos testes e como "multijogador local". Um lobby `hz-lobby-<sala>` entrega um canal par-a-par `hz-pair-…`.
* **Manual**: SDP mínimo (só m=application) reconstruído por template; só vão: fingerprint SHA-256 (32 B), ufrag, pwd, candidatos UDP (IPv4 4 B / IPv6 16 B / mDNS-UUID 16 B + porta) → binário → `deflate-raw` (se encolher) → CRC16 → base64url com prefixo `hz1.`. Um convite típico tem 105–170 chars (um SDP bruto comprimido passa de 400). O `deflate-raw` só é aplicado quando encolhe (quase nunca: o payload já é binário denso); o ganho vem do formato.
* **Trystero** (`trystero` 0.26, estratégia Nostr; BitTorrent/MQTT trocáveis): relays públicos só servem de ponto de encontro (nada nosso). O anfitrião entra na sala `código`; o visitante envia uma sonda e escolhe o par que responde "sou o host". A malha do Trystero também liga visitantes entre si — essas conexões são ignoradas (≤ 8 jogadores). Tudo é `try/catch` com timeout de 25 s: falha → mensagem amigável + sugestão do modo manual. **⚠ Não testado nesta máquina** (sem saída de rede no sandbox): a camada acima do Trystero (sondas, `TrysteroTransport`) é a parte nova e nunca falou com relays reais.

## 4. Protocolo (JSON, `PROTO = 1`)

Todas as mensagens são `{t:'tipo', …}`. Mensagens > 12 000 chars viram fragmentos `{t:'big',id,i,n,s}` no canal confiável e são remontadas (limite 8 M chars); o `welcome` com lista de edições grande usa isso. Quadros inválidos são descartados (`Link.bad`).

| Direção | Mensagem | Conteúdo |
|---|---|---|
| G→H | `hello` | `{ver,id,name,color,tok}` (tok = convite de uso único) |
| H→G | `welcome` | `{planet:PlanetInfo, edits:number[], time,speed,weather, snapshots:{key:any}, you:{id}, hostId,hostName, players:[…], dome:{mode,perms,max}, pos:[x,y,z]}` |
| H→G | `reject` | `{reason:'closed'|'full'|'invite'|'version'}` |
| G→H | `pos` (não confiável, ~15 Hz) | `{p:[x,y,z,yaw,pitch,flags,hp,team,item]}` flags: 1 agachar, 2 nadar, 4 voar, 8 correr, 16 no chão |
| H→G | `snap` (não confiável, ~15 Hz) | `{s:[[id,x,y,z,yaw,pitch,flags,hp,team,item],…]}` (todos menos o destinatário, anfitrião incluído) |
| ambos | `ls` | `localState.extra` (JSON ≤ 600 chars) quando muda |
| G↔H | `eb` (contrato fala em `edit`; aqui vai em lote) | lote de edições `[x,y,z,id,prev, …]` (≤ 40/lote). G→H = intenção; H→G = estado oficial |
| H→G | `efix` | correção de uma edição rejeitada |
| G→H→todos | `chat` | `{text}` → `{id,name,color,text}` (≤ 200 chars, 1,2 msg/s) |
| ambos | `x` | mensagem de feature `{k:'mg:state', d:data, f:from}` (`net.send/broadcast/on`) |
| H→G | `roster` (3 s), `join`, `leave`, `time` (4 s), `weather`, `dome`, `kick`, `bye` | |
| ambos | `ping`/`pong` | RTT → `ctx.net.latency()` |

**Confiança.** Nomes e textos do planeta recebidos perdem `< > & " \`` (outras features podem usar `innerHTML`); a lista de edições do `welcome` é filtrada tupla a tupla antes de chegar ao motor. O visitante é não-confiável: o host limita taxa por tipo (token bucket), tamanho, valida números (clamp), `id` de bloco ∈ [0,254], `y` ∈ [0,191], **alcance ≤ 30 blocos** da última posição do jogador, e `ctx.permissions.can('place'|'break', {x,y,z,id,by})` (que inclui as regras do domo). Edições do host (`source` `'local'|'game'`) são retransmitidas automaticamente ouvindo `world:blockSet`; `'remote'` nunca é re-enviada (evita eco). O visitante aplica a edição otimisticamente; se o host rejeitar, `efix` desfaz. Modelo de confiança é de amigos (sem anti-cheat); texto de rede só vai ao DOM por `textContent`.

## 5. Domo (`ctx.dome`)

`{ mode:'closed'|'open'|'invite', set(mode), perms:{build,break,pvp,fly}, setPerm(k,v), maxPlayers }`. Eventos: `dome:change {mode}`, `dome:perms {perms}`.
`closed` = sem conexões (e expulsa); `open` = qualquer um com o código/link; `invite` = precisa do token de uso único (`net.newInvite()`); convites manuais valem como convite em `open` e `invite`.
Permissões são impostas no host (validação das edições dos visitantes) **e** aplicadas no visitante via `ctx.permissions.add` (`place`←build, `break`←break, `pvp`←pvp para todos dentro do domo, `fly`←fly; `Sync.frame` também desliga o voo). Até o `Interaction` chamar `permissions.can` (G), o visitante desfaz localmente uma construção proibida.

## 6. Avatares e jogadores remotos

`ctx.net.players: Map<id, RemotePlayer>` (somente remotos): `{id,name,color,pos(Vector3 suavizado),yaw,pitch,vel,hp,team,item,alive,ping, extra}`. Interpolação: buffer de 8 amostras por jogador, render a `now − 110 ms`, extrapolação ≤ 260 ms, teleporte > 24 blocos faz snap.
Avatar: humanoide em caixas (cabeça/tronco/braços/pernas + item na mão), cor por jogador, caminhada pela velocidade, poses agachar/nadar/voar/morto, etiqueta de nome em atlas de canvas, esmaece de 120 a 165 blocos. **Um** `InstancedBufferGeometry` com pivôs por vértice (como `render/Mobs.js`) + **um** quad instanciado para nomes. Zero custo quando ninguém está conectado (o objeto só é criado quando há jogadores; `net.tick` retorna na primeira linha em solo). Aba em segundo plano: um timer de 250 ms mantém ping/edições/snapshots vivos mesmo sem `requestAnimationFrame`.

## 7. UI

* Menu: **Entrar em um planeta** (código, `?join=CÓDIGO`, modo manual, aviso de NAT). Sem `RTCPeerConnection` (Artifact do Claude) o painel explica que só abas locais funcionam.
* Jogo: **O** / botão 🌐: chave de domo com 3 estados grandes (🔒 Fechado / 🌐 Aberto / 🎟️ Por convite), convidar (código, link, QR, convite de uso único, convite manual), lista de jogadores (ping, **Expulsar**, **➜ teleportar**), permissões, chat. Visitante: anfitrião, ping, jogadores, regras, **Sair**.
* Chat: sobreposição que esmaece no HUD + **Enter** para digitar (as teclas do jogo ficam suspensas enquanto digita).
* **F3**: linha extra `NET … ↓/↑ bytes/s, msg/s, ping` (`ctx.events.emit('net:stats', {role,peers,inBps,outBps,msgIn,msgOut,ping})` 1×/s).

## 8. API pública (extras além do CONTRACT2 §3)

`net.chat(text)`, `net.leave()`, `net.newInvite()`, `net.newManualInvite()`, `net.hostInfo`, `net.chatLog`, `net.hostName`, `net.stats`, eventos `net:chat`, `net:stats`, `net:hostInfo`, `net:closed`, `dome:perms`. Mensagens de feature: `net.on('mg:state', (data, fromId) => …)`, `net.send(type, data, {to, reliable})`, `net.broadcast(type, data, {except, reliable})`. Mensagens que chegam enquanto o guest ainda carrega são guardadas e entregues no `ready`. `registerSnapshot(key,{get,set})`: o host chama `get()` no `welcome`; o guest chama `set()` assim que o handler é registrado (mesmo se registrar depois do `welcome`).

## 9. Testes

`node scripts/nettest.mjs [--variant=local|rtc|all] [--url=http://localhost:5302] [--shots=DIR]` (Chromium headless, `quality=potato`, 640×360, 2 páginas).
* **local**: um contexto, duas abas → `LocalTransport`. Prova: convite de uso único (recusa sem token / token consumido), join, snapshot de edições (chunk carregado e **descarregado**), edição ao vivo nos dois sentidos, edição em chunk descarregado do host, posições, chat (HTML escapado), mensagens de feature, permissões (revertidas no guest, rejeitadas no host mesmo com cliente adulterado), limite de alcance, mensagens hostis ignoradas, stats, **kick**, domo fechado recusa, reabrir aceita, fechar avisa os visitantes.
* **rtc**: dois contextos isolados (sem BroadcastChannel entre eles) → **WebRTC real em loopback** com códigos manuais (Chromium com `--disable-features=WebRtcHideLocalIpsWithMdns`), mesmas verificações funcionais; confere tamanho dos códigos e rejeição de código corrompido.
Mais: `node scripts/nettest-unit.mjs` (sem navegador): codec dos códigos manuais (ida e volta, IPv4/IPv6/mDNS, CRC), fragmentação do `Link`, `parseJoin`, sanitizadores e o **driver Trystero contra um `joinRoom` falso em memória** (única verificação possível da camada Trystero aqui). O e2e também cobre 3 jogadores (relay visitante↔visitante), `?join=` por link, reconexão, chat por Enter, linha F3, espectar, hora/clima.
Capturas de tela dos dois lados (avatares, etiquetas, chat) vão para `--shots` (padrão `$TMPDIR/hz-nettest`). Parâmetros de URL úteis: `nettrystero=0` (não usa relays públicos), `netstun=0` (sem STUN, para rede offline).

## 10. Limitações conhecidas

* Sem TURN: NAT simétrico/CGNAT pode falhar (ver §3). A reconexão automática só vale para entradas por código de sala; depois de esgotar as tentativas (ou se o host fechou/expulsou) o visitante volta ao menu.
* Trystero **não testado** nesta máquina. Em malha, cada visitante também conecta aos outros visitantes (ignorado).
* Anfitrião e visitantes precisam da mesma versão (`PROTO`); o planeta de visitante é regenerado a partir de `seed + profile` e das edições — não há streaming de chunks.
* Confiança entre amigos: sem anti-cheat; o host valida alcance/permissões/formato, não física.
* Mobs/animais são locais de cada cliente (não replicados) — mobs "de verdade" (G/M) devem usar `net.broadcast` a partir da autoridade.
* Espectar é só câmera (o corpo do espectador fica parado onde estava); sem colisão da câmera com o terreno.
* Sem WebRTC e sem BroadcastChannel (Artifact do Claude) não há como hospedar nem entrar: os botões explicam e ficam desativados. O resto do jogo (solo) segue igual.
