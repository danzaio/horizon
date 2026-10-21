// Tiny DOM helpers + the descriptor-driven parameter widgets used by the editor. Text always goes through textContent / .value (never innerHTML).
import { ENTITY_TYPES, MATERIALS, matLabel } from './schema.js';

/** h('div', {class, onclick, value, checked…}, ...children) — strings become text nodes. */
export function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  if (props) for (const k of Object.keys(props)) {
    const v = props[k]; if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) e[k] = v; else if (k === 'class') e.className = v; else if (k === 'value' || k === 'checked') e[k] = v; else if (k === 'readonly') e.readOnly = true; else if (k === 'list') e.setAttribute('list', v); else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c !== '' && c !== undefined && c !== null) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}

/** <select> from [[value,label],…]. */
export function selectOf(options, cur, onChange) {
  const s = h('select', { onchange: (e) => onChange(e.target.value) });
  for (const [v, l] of options) s.appendChild(h('option', { value: v }, l));
  s.value = cur; if (s.value !== cur && options.length) s.selectedIndex = 0; return s;
}

/**
 * Input widget for one schema param spec. onChange gets the raw new value (the caller cleans it with cleanParam).
 * @param {object} ctx feature ctx @param {object} def GameDef @param {object} spec descriptor @param {*} val current value
 */
export function paramField(ctx, def, spec, val, onChange, o = {}) {
  switch (spec.kind) {
    case 'int': case 'num': return h('input', { type: 'number', min: spec.min, max: spec.max, step: spec.step || 1, value: val, onchange: (e) => onChange(e.target.value) });
    case 'bool': return h('input', { type: 'checkbox', checked: !!val, onchange: (e) => onChange(e.target.checked) });
    case 'text': return h('input', { type: 'text', maxlength: spec.max, value: val, onchange: (e) => onChange(e.target.value) });
    case 'name': return h('input', { type: 'text', maxlength: 16, value: val, placeholder: 'a-z, 0-9', onchange: (e) => onChange(e.target.value.trim()) });
    case 'select': return selectOf(spec.options, val, onChange);
    case 'team': return selectOf([['', '(qualquer)'], ...def.meta.teams.map((t) => [t.id, t.name])], val, onChange);
    case 'item': return h('input', { type: 'text', list: 'mg-items', maxlength: 40, value: val, placeholder: ctx.items ? 'id do item' : 'itens indisponíveis', onchange: (e) => onChange(e.target.value.trim()) });
    case 'material': return selectOf([...(spec.key === 'material' ? [['air', 'Ar (vazio)']] : []), ...MATERIALS.map((m) => [m, matLabel(m)])], val, onChange);
    case 'entity': {
      const types = o.entTypes, list = def.entities.filter((e) => !types || types.includes(e.type));
      return selectOf([['', o.none || '(nenhum)'], ...list.map((e) => [e.id, `${ENTITY_TYPES[e.type].icon} ${e.name || ENTITY_TYPES[e.type].label} · ${e.id}`])], val, onChange);
    }
    default: return h('span', null, String(val));
  }
}
