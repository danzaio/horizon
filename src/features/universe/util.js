// Small DOM helpers shared by the universe UI.
/** clipboard with a textarea fallback (iframes / insecure contexts) */
/** copy text to the clipboard (falls back to a hidden textarea in iframes / insecure contexts) @returns {Promise<void>} */
export function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  return Promise.resolve(fallbackCopy(text));
}
function fallbackCopy(text) {
  const t = document.createElement('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0'; document.body.appendChild(t); t.select();
  try { document.execCommand('copy'); } catch { /* ignore */ } t.remove();
}
