// Guitar Briga III as ONE self-contained HTML file (JS, CSS and Three.js inlined) -> dist-luta/index.html.
// Open it by double-click, drop it on any static host, or send it over chat: no server needed.
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve(import.meta.dirname, 'luta'),
  base: './',
  plugins: [viteSingleFile()],
  build: { target: 'esnext', outDir: resolve(import.meta.dirname, 'dist-luta'), emptyOutDir: true, chunkSizeWarningLimit: 4000 },
});
