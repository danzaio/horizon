// Tiny DOM helpers for the net UI. Everything that came from the network goes through textContent, never innerHTML.
export function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  if (props) for (const k in props) {
    const v = props[k];
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v !== undefined && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}

/** Copy text to the clipboard (async API with a textarea fallback). @returns {Promise<boolean>} */
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  try {
    const t = h('textarea', { style: 'position:fixed;left:-999px;top:0' }); t.value = text; document.body.append(t); t.select();
    const ok = document.execCommand('copy'); t.remove(); return ok;
  } catch { return false; }
}

export function copyButton(label, getText, ui) {
  const b = h('button', { class: 'btn sm', type: 'button', text: label });
  b.addEventListener('click', async () => { const ok = await copyText(getText()); if (ui) ui.toast(ok ? 'Copiado!' : 'Não consegui copiar: selecione o texto e use Ctrl+C'); });
  return b;
}

/** QR code on a canvas (returns null when the text does not fit). */
export async function qrCanvas(text, px = 168) {
  try {
    const { default: qrcode } = await import('qrcode-generator');
    const q = qrcode(0, 'L'); q.addData(text); q.make();
    const n = q.getModuleCount(), m = 2, cell = Math.max(1, Math.floor(px / (n + m * 2))), size = (n + m * 2) * cell;
    const c = h('canvas', { class: 'nt-qr', width: size, height: size }), g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, size, size); g.fillStyle = '#000';
    for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.isDark(r, k)) g.fillRect((k + m) * cell, (r + m) * cell, cell, cell);
    return c;
  } catch (e) { console.warn('[HZ] QR failed:', e && e.message); return null; }
}

/** Escape-free colour check for style attributes */
export const safeColor = (c) => (/^#[0-9a-f]{6}$/i.test(c) ? c : '#9db0d9');
