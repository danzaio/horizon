// Turns dist-single/index.html into a page body suitable for the Artifact tool (it adds its own doctype/html/head/body skeleton).
// Usage: node scripts/make-artifact.mjs <in.html> <out.html> "<Title>"
import fs from 'node:fs';
const [, , inp, out, title = 'Horizon Mundo Infinito'] = process.argv;
let h = fs.readFileSync(inp, 'utf8');
h = h.replace(/<!doctype html>/i, '').replace(/<\/?html[^>]*>/gi, '').replace(/<\/?head>/gi, '').replace(/<\/?body[^>]*>/gi, '');
h = h.replace(/<title>[\s\S]*?<\/title>/i, '').replace(/<meta charset[^>]*>/i, '').replace(/<meta name="viewport"[^>]*>/i, ''); // the skeleton already provides charset + viewport
h = `<title>${title}</title>\n` + h.trim() + '\n';
fs.writeFileSync(out, h);
console.log('wrote', out, (h.length / 1024).toFixed(0) + ' kB');
