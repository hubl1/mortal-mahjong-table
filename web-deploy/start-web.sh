#!/usr/bin/env bash

set -euo pipefail

ROOT=$(cd -- "$(dirname -- "$0")/.." && pwd)
NODE=${MORTAL_NODE:-"$ROOT/.runtime/node/bin/node"}
PYTHON=${MORTAL_PYTHON:-"$ROOT/.venv/bin/python"}
GAME_PORT=${MORTAL_GAME_PORT:-4615}
POOL_PORT=${MORTAL_POOL_PORT:-14615}
ADVISOR_PORT=${MORTAL_ADVISOR_PORT:-15615}
GATEWAY_PORT=${MORTAL_GATEWAY_PORT:-4614}

mkdir -p "$ROOT/logs" "$ROOT/paipu"

if [[ ! -x "$NODE" ]]; then
  echo "Missing Node runtime: $NODE" >&2
  exit 1
fi
if [[ ! -x "$PYTHON" ]]; then
  echo "Missing Python environment: $PYTHON" >&2
  exit 1
fi

export PATH="$ROOT/.runtime/node/bin:/usr/lib/wsl/lib:$PATH"
export MORTAL_ROOT="$ROOT"
export MORTAL_MODEL_PATH=${MORTAL_MODEL_PATH:-"$ROOT/models/mortal-finetune-ours560-step-1100000.pth"}
export MORTAL_GAME_PORT="$GAME_PORT"
export MORTAL_POOL_PORT="$POOL_PORT"
export MORTAL_ADVISOR_PORT="$ADVISOR_PORT"
export MORTAL_GATEWAY_PORT="$GATEWAY_PORT"
export CUDA_MODULE_LOADING=LAZY

PIDS=()
cleanup() {
  trap - EXIT INT TERM
  for pid in "${PIDS[@]:-}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

"$PYTHON" "$ROOT/vendor/Akagi-MjaiBot-Mortal-main/bot_pool.py" \
  --port "$POOL_PORT" --http-port "$ADVISOR_PORT" \
  >>"$ROOT/logs/mortal-pool.log" 2>&1 &
PIDS+=("$!")

"$NODE" "$ROOT/runtime/node_modules/@kobalab/majiang-server/bin/server.js" \
  --port "$GAME_PORT" \
  --docroot "$ROOT/vendor/Majiang-master/dist" \
  --callback "/netplay.html?local=1&autostart=1&renderer=web" \
  --status \
  >>"$ROOT/logs/server.log" 2>&1 &
PIDS+=("$!")

for _ in $(seq 1 120); do
  if curl -fsS "http://127.0.0.1:$GAME_PORT/netplay.html" >/dev/null 2>&1 \
      && "$PYTHON" - "$POOL_PORT" <<'PY' >/dev/null 2>&1
import socket, sys
with socket.create_connection(("127.0.0.1", int(sys.argv[1])), timeout=.2):
    pass
PY
  then
    break
  fi
  sleep 1
done

"$NODE" "$ROOT/web-deploy/gateway.js" >>"$ROOT/logs/gateway.log" 2>&1 &
PIDS+=("$!")

echo "Mortal web is ready on http://127.0.0.1:$GATEWAY_PORT/mortal/"
wait -n "${PIDS[@]}"
