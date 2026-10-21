// Single-file build (everything inlined: JS, CSS, workers as blob) -> dist-single/index.html. Used for sandboxed hosting / sharing.
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

const inlineWorker = {
  name: 'hz-inline-worker', enforce: 'pre',
  transform(code, id) {
    if (!id.endsWith('WorkerPool.js')) return null;
    const needle = "new Worker(new URL('./chunk.worker.js', import.meta.url), { type: 'module' })";
    if (!code.includes(needle)) throw new Error('hz-inline-worker: WorkerPool.js worker construction changed');
    return { code: "import ChunkWorker from './chunk.worker.js?worker&inline';\n" + code.replace(needle, 'new ChunkWorker()'), map: null };
  },
};

export default defineConfig({
  base: './',
  plugins: [inlineWorker, viteSingleFile()],
  worker: { format: 'es' },
  build: { target: 'esnext', outDir: 'dist-single', emptyOutDir: true, chunkSizeWarningLimit: 4000 },
});
