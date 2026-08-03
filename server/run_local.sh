#!/usr/bin/env bash
# Run the live demo backend on this machine.
#
#   ./server/run_local.sh              # serve on localhost:8000
#   ./server/run_local.sh --tunnel     # ...and expose it publicly via cloudflared
#
# On macOS the Minecraft window will appear — that's the server's own window,
# not the website's. The browser only ever sees the streamed frames. Minimise it.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-8000}"
export PORT

if [ ! -f data/VPT-models/rl-from-early-game-2x.weights ]; then
  cat >&2 <<'MSG'
Missing VPT weights. Download them first (~950 MB):

  mkdir -p data/VPT-models && cd data/VPT-models
  curl -LO https://openaipublic.blob.core.windows.net/minecraft-rl/models/2x.model
  curl -LO https://openaipublic.blob.core.windows.net/minecraft-rl/models/rl-from-early-game-2x.weights
MSG
  exit 1
fi

# Some transformer ops have no MPS kernel; fall back to CPU for those rather
# than crashing. Harmless on CUDA and CPU machines.
export PYTORCH_ENABLE_MPS_FALLBACK=1

python3 -c "import sys; sys.path.insert(0,'.'); from server.vpt_agent import pick_device; print('device:', pick_device())"

if [ "${1:-}" = "--tunnel" ]; then
  command -v cloudflared >/dev/null || { echo "cloudflared not found: brew install cloudflared" >&2; exit 1; }
  echo "starting tunnel -> the https URL below goes in web/config.js as DEMO_BACKEND"
  cloudflared tunnel --url "http://localhost:${PORT}" &
  trap 'kill %1 2>/dev/null || true' EXIT
fi

# Linux/servers need a virtual display; macOS renders natively.
if [ "$(uname)" = "Linux" ] && command -v xvfb-run >/dev/null; then
  exec xvfb-run -a python3 server/demo_server.py
fi
exec python3 server/demo_server.py
