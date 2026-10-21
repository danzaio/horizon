// Universe feature (U): addresses, procedural planets with their own look and rules, galaxy map, hyperspace travel, home dome.
// Docs: docs/PLANETS.md.  Public API: ctx.universe (docs/CONTRACT2.md §3).
import { defineFeature } from '../registry.js';
import { decodeAddress, normalizeAddress } from './address.js';
import { homeAddress, generatePlanet, describe } from './generator.js';
import { TYPES, sanitizeProfile } from './profiles.js';
import { openMap, hyperspace } from './map.js';
import { drawPlanetIcon } from './planetIcon.js';
import { initDome, readyDome, updateDome, disposeDome } from './dome.js';
import { copyText } from './util.js';
import { hasSave } from '../../game/Save.js';
import './universe.css';

const VISITED_KEY = 'horizon.universe.visited.v1', TRAVEL_FLAG = 'hz.travel';

function loadVisited() { try { const v = JSON.parse(localStorage.getItem(VISITED_KEY) || '[]'); return Array.isArray(v) ? v.filter((a) => typeof a === 'string' && decodeAddress(a)).slice(-300) : []; } catch { return []; } }
function saveVisited(list) { try { localStorage.setItem(VISITED_KEY, JSON.stringify(list.slice(-300))); } catch { /* storage unavailable */ } }

/** the seed the pre-planets game derived from the player id (same hash as main.js parseSeed) */
function legacyHomeSeed(id) {
  if (/^-?\d+$/.test(id)) return parseInt(id, 10) | 0;
  let h = 2166136261; for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % 1000000000;
}

/** PlanetInfo for an address (profile comes from the generator, never from the network). */
function planetInfo(address, identity, isHome) {
  const g = generatePlanet(address);
  if (!g) return null;
  return {
    seed: g.seed, address: g.address, name: g.name, type: g.type, profile: g.profile,
    ownerId: identity.id, ownerName: identity.name, isHome: !!isHome, domeMode: isHome ? 'closed' : 'open',
  };
}

/** archetype of a PlanetInfo (its type string may come from the network: own keys only) */
const typeOf = (planet) => (Object.prototype.hasOwnProperty.call(TYPES, planet.type) ? TYPES[planet.type] : null);

let burn = 0, warned = false;   // magma-sea damage timer / one-time warning

export default defineFeature({
  id: 'universe', order: 10,

  /** menu phase: show the player's own address and let them visit another planet by code */
  menu({ ui, identity, startGame }) {
    const qs = new URLSearchParams(location.search);
    let flagged = false; try { flagged = sessionStorage.getItem(TRAVEL_FLAG) === '1'; sessionStorage.removeItem(TRAVEL_FLAG); } catch { /* ignore */ }
    ui.addMenuButton({ label: '🪐 Meu endereço no universo', hint: 'Seu planeta natal tem um código que você pode compartilhar', onClick: () => {
      const home = homeAddress(identity.id), d = describe(home), el = document.createElement('div');
      el.className = 'uv-menu';
      el.innerHTML = `<canvas class="uv-home-ico" width="180" height="180"></canvas><p>Seu planeta natal <b></b> fica no endereço:</p><div class="uv-addr"></div><p class="dim uv-sum"></p><p class="note dim">Cole um endereço no campo de semente para visitar outro planeta. Dentro do jogo, a tecla <kbd>J</kbd> abre o mapa da galáxia.</p><div class="row"><button class="btn primary" data-a="copy">Copiar endereço</button></div>`;
      el.querySelector('b').textContent = d ? d.name : '';
      el.querySelector('.uv-sum').textContent = d ? d.summary : '';
      drawPlanetIcon(el.querySelector('.uv-home-ico'), generatePlanet(home));
      el.querySelector('.uv-addr').textContent = home;
      el.querySelector('[data-a=copy]').onclick = () => copyText(home).then(() => ui.toast('Endereço copiado'));
      ui.panel({ id: 'uv-home', title: 'Meu planeta', content: el, width: 460 });
    } });
    if (flagged && qs.get('planet') && normalizeAddress(qs.get('planet'))) startGame({ seedStr: '' });   // arriving from a hyperspace jump: no extra click on "Jogar"
  },

  /**
   * ?planet=ADDRESS wins; an address typed in the seed box visits that planet; numbers/text keep the legacy world (profile null);
   * an empty box means the player's home planet. `?autostart=1` without ?planet keeps the legacy world so existing test scripts are unchanged.
   */
  async resolvePlanet({ identity, seedStr, params }) {
    const q = new URLSearchParams(location.search).get('planet');
    const typed = (seedStr || '').trim();
    if (q) { const a = normalizeAddress(q); if (a) return planetInfo(a, identity, a === homeAddress(identity.id)); }
    if (params && params.seed) return null;
    if (typed) { const a = normalizeAddress(typed); return a ? planetInfo(a, identity, a === homeAddress(identity.id)) : null; }
    if (params && params.autostart) return null;
    if (hasSave(legacyHomeSeed(identity.id))) return null;   // a player who already has a saved "Seu planeta" keeps it (legacy world); new players get a real home planet
    const home = homeAddress(identity.id);
    return planetInfo(home, identity, true);
  },

  init(ctx) {
    const { gr, ui, planet, identity, events } = ctx;
    let prof = planet.profile ? sanitizeProfile(planet.profile) : null;   // PlanetInfo may have crossed the network: never trust its shape
    if (planet.profile && !prof) { console.warn('[HZ] universe: invalid planet profile ignored'); planet.profile = null; }
    else if (prof) planet.profile = prof;
    if (gr.setPlanetLook) gr.setPlanetLook(prof);
    if (prof && ctx.player) ctx.player.gravityScale = prof.gravity;
    const visited = loadVisited();
    if (planet.address && !visited.includes(planet.address)) { visited.push(planet.address); saveVisited(visited); }

    const api = {
      planet,
      homeAddress: (id) => homeAddress(id),
      profileFor: (a) => { const g = generatePlanet(a); return g ? g.profile : null; },
      describe: (a) => describe(a),
      openMap: () => openMap(ctx, api),
      travel: (a) => {
        const addr = normalizeAddress(a);
        if (!addr) { ui.toast('Endereço inválido'); return; }
        if (ctx.role !== 'solo') { ui.toast('Viagem indisponível durante uma partida online'); return; }
        if (addr === planet.address) { ui.toast('Você já está neste planeta'); return; }
        events.emit('universe:travel', { address: addr });
        try { if (window.__hz && window.__hz.save) window.__hz.save(); } catch { /* ignore */ }
        hyperspace(generatePlanet(addr), () => {
          try { sessionStorage.setItem(TRAVEL_FLAG, '1'); } catch { /* ignore */ }
          const url = new URL(location.href); url.search = ''; url.searchParams.set('planet', addr);
          const keep = new URLSearchParams(location.search); for (const k of ['quality', 'notouch', 'touch']) if (keep.has(k)) url.searchParams.set(k, keep.get(k));
          location.href = url.toString();
        });
      },
      visited,
    };
    ctx.universe = api;

    const T = typeOf(planet);
    ui.setPlanetBadge(planet.name ? `<b>${esc(planet.name)}</b>${T ? ' · ' + T.label : ''}${planet.address ? ' · ' + esc(planet.address) : ''}${ctx.role === 'guest' ? ' · visitante' : ''}` : '');
    ui.addToolbarButton({ id: 'galaxy', icon: '🪐', title: 'Mapa galáctico', key: 'J', onClick: () => api.openMap() });
    ctx.addHotkey('KeyJ', () => api.openMap());
    initDome(ctx);
    events.emit('universe:ready', { address: planet.address, type: planet.type, name: planet.name });
  },
  ready(ctx) {
    readyDome(ctx);
    const T = typeOf(ctx.planet);
    if (T && ctx.planet.profile) ctx.ui.toast(`${ctx.planet.name} · planeta ${T.label.toLowerCase()} · ${ctx.planet.profile.gravity.toFixed(2)} g`);
  },
  update(dt, ctx) {
    updateDome(dt, ctx);
    const p = ctx.planet.profile;
    if (p && p.seaGlow > 0.5 && ctx.player.inWater && ctx.health && ctx.health.alive) {   // magma sea: swimming in it burns
      burn += dt;
      if (burn > 0.55) { burn = 0; ctx.health.damage(3, 'lava'); if (!warned) { warned = true; ctx.ui.toast('O mar é de magma! Saia já!'); } }
    } else burn = 0;
  },
  dispose(ctx) { disposeDome(ctx); },
});

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
