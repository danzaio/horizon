#!/usr/bin/env bash
# Publish Guitar Briga III on a temporary public URL (playable from any PC / phone) using a tunnel.
# Usage: scripts/luta-online.sh            (needs `cloudflared`, else falls back to localtunnel via npx)
#   cloudflared: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${PORT:-4173}"
npm ci --silent
npx vite build --logLevel error
npx vite preview --host 0.0.0.0 --port "$PORT" --strictPort >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
sleep 2
echo "Local:  http://localhost:$PORT/luta/"
echo "Aguarde o link público abaixo (…/luta/) e mande para quem quiser jogar. Ctrl+C encerra."
if command -v cloudflared >/dev/null 2>&1; then
  cloudflared tunnel --url "http://localhost:$PORT"
else
  npx --yes localtunnel --port "$PORT"
fi
