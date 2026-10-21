# HORIZON (Three.js voxel + planetas P2P)

**Leia primeiro:** `docs/MEMORY.md` (estado vivo, preferências do usuário, checklist) e `docs/CONTRACT2.md` (contrato vinculante dos plugins).
**Ao terminar qualquer rodada de trabalho, atualize `docs/MEMORY.md`** (estado, log com hora UTC, pendências).

- Idioma com o usuário: português BR, curto e direto.
- Build: `npm run build` (Vite, `base: './'`); single-file via `vite-plugin-singlefile`. Servir com `scripts/serve.sh <dir> <porta>`.
- Features em `src/features/<nome>/index.js` (carregadas por glob). Não editar arquivos compartilhados além do mínimo; ver contrato.
- Só há WebGL por software no sandbox: não dá para medir FPS real; use screenshots (`scripts/shot.mjs`) e soak tests.
- Nunca incluir identificador de modelo em commits/PRs/código.
