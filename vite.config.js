import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({
  base: './',
  worker: { format: 'es' },
  build: {
    target: 'esnext', chunkSizeWarningLimit: 2000,
    // two pages: the voxel world (index.html) and the GH3-style fighting game (luta/index.html)
    rollupOptions: { input: { main: resolve(import.meta.dirname, 'index.html'), luta: resolve(import.meta.dirname, 'luta/index.html') } },
  },
  server: { host: '0.0.0.0', port: 5173 },
});
