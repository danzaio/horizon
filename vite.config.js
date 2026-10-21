import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  worker: { format: 'es' },
  build: { target: 'esnext', chunkSizeWarningLimit: 2000 },
  server: { host: '0.0.0.0', port: 5173 },
});
