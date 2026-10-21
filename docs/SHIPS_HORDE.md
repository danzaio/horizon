# Naves e Horda (rodada inline)

## Naves (`src/features/ships/`)
* `B` chama a sua nave (aparece em chão livre perto de você) · perto dela, `B` embarca · pilotando, `B` desembarca (só perto do chão). Botão 🚀 na barra.
* Voo: mouse mira, `W/S` frente/trás, `A/D` lateral, `Espaço`/`C` sobe/desce, `Shift` turbo (FOV abre, chama maior), roda do mouse = distância da câmera, `Z` alterna 3ª pessoa ↔ cabine (1ª pessoa com moldura de canopy).
* Armas: clique esquerdo = lasers das asas (hitscan 4,5 dano, converge na mira), botão direito = míssil (explode, cratera). Usam `ctx.combat` (dano em jogadores, animais e monstros).
* Colisão com os blocos (AABB 2,4×1×2,6); batida forte causa dano ao piloto. Teto de voo y=420; acima de y=200 aparece "ÓRBITA — J: mapa galáctico" (salto de dobra) e, depois do salto, você chega **já embarcado**.
* **Dois na mesma nave:** o dono pilota; outro jogador perto da nave pressiona `B` e vira **artilheiro** (torreta no topo, mira livre, laser/míssil saindo da nave). Quando o piloto pousa/sai, o artilheiro é desembarcado.
* Rede: `ship:s` (pose a 10 Hz enquanto pilota, 1,5 s parada), `ship:g` (aviso de artilheiro). API: `ctx.ship = { call, board, exit, piloting, state }`.

## Horda (`src/features/horde/`) — estilo Helldivers
* `H` (ou 👾) abre o painel: dificuldade + **Iniciar horda**. A autoridade (solo/host) simula; convidados veem os monstros por `hd:s` (10 Hz) e mandam dano por `hd:hit`; dano dos monstros nos jogadores via `hd:dmg`.
* Ondas: 5+4·onda monstros (×jogadores, ×dificuldade). Tipos: **Rastejante** (rápido, corpo a corpo), **Bruto** (tanque), **Vespa** (voa atrás da nave/jogador), **Titã** (chefe a cada 5 ondas). Entre ondas: cura +10 e 7 s de pausa.
* Alvos de `combat.hitscan/sweep/projectile/explode/melee` incluem `ctx.horde.list` — todas as armas (fuzil, escopeta, railgun, lança-mísseis, granada, mina, laser da nave…) funcionam nos monstros.
* API: `ctx.horde = { list, authority, running, wave, kills, damage(m, amount, kx, kz, by, lift), start(diff), stop(), spawn(tipo) }`; eventos `horde:start|wave|kill|stop`.

## Online mais simples
* 🔗 (barra, ou botão grande no painel `O`): abre o domo e **copia o link** — o amigo só abre o link e entra no seu mundo (`?join=CÓDIGO`, tenta por até ~2 min).
* 🧭: teleporta até o amigo mais próximo.
* Rendezvous por Nostr + BitTorrent + MQTT ao mesmo tempo e TURN público de fallback (CGNAT/NAT simétrico). O painel mostra quantos relays estão realmente conectados.

## Minimapa (`src/features/minimap/`)
Mapa redondo no canto superior direito: terreno analítico (mostra até terra ainda não carregada), cores por bioma/planeta, relevo sombreado, água por profundidade. Marcadores: você (seta), amigos (cor deles), monstros da horda (vermelho/rosa), sua nave (losango ciano), pontos nas bordas quando fora do alcance. Botões `+` `−` (ou teclas `=` / `-`) mudam o zoom (1–8 blocos por célula), ⌖ alterna "direção do olhar para cima" / "norte fixo", `\` esconde/mostra. Células em cache preenchidas aos poucos (90/160/280 por quadro conforme a qualidade). A barra de botões desceu e quebra em colunas.

## Salas públicas
* **Ver:** menu inicial → "🌍 Salas públicas": lista nome, dono, tipo de planeta e jogadores (n/8); "Entrar" abre o fluxo normal de entrada por código.
* **Listar a sua:** no painel Online (`O`), modo **Aberto** → "🌍 Listar na lista pública" (nome editável). Só aparece enquanto o domo está Aberto; "Remover da lista" desfaz; fechar o domo também.
* Como funciona sem servidor: uma sala Trystero fixa ("lobby", mesmas redes Nostr/Torrent/MQTT do convite); hosts anunciam `{código, nome, dono, tipo, n/max}` a cada 5 s, o navegador de salas coleta (expira em 20 s). Dados sanitizados (`sanitizeAd`). API: `net.setPublic(on, nome)`, `lobbyJoin({onAd,getAd})`.
