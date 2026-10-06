#!/usr/bin/env bash

set -euo pipefail

ANDROID_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(cd -- "$ANDROID_DIR/.." && pwd)
TABLE_SOURCE="$ROOT/vendor/Majiang-master/dist"
TABLE_TARGET="$ANDROID_DIR/app/src/main/assets/table"
MODEL_TARGET="$ANDROID_DIR/app/src/main/assets/model/mortal-v4-fp32.onnx"
MODEL_SOURCE=${1:-}

if [[ -z "$MODEL_SOURCE" || ! -f "$MODEL_SOURCE" ]]; then
  echo "Usage: $0 /absolute/path/to/compatible-mortal-v4.onnx" >&2
  exit 2
fi
if [[ ! -f "$TABLE_SOURCE/index.html" ]]; then
  echo "Build the web table first: (cd vendor/Majiang-master && npm run release)" >&2
  exit 1
fi

mkdir -p "$TABLE_TARGET" "$(dirname -- "$MODEL_TARGET")"
rsync -a --delete "$TABLE_SOURCE/" "$TABLE_TARGET/"
cp "$MODEL_SOURCE" "$MODEL_TARGET"

echo "Android table assets and model are ready."
