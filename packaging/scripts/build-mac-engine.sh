#!/bin/zsh

set -euo pipefail

SCRIPT_DIR=${0:A:h}
TABLE_ROOT=${SCRIPT_DIR:h:h}
PYTHON="$TABLE_ROOT/.venv311/bin/python"
BOT_ROOT="$TABLE_ROOT/vendor/Akagi-MjaiBot-Mortal-main"
OUTPUT="$TABLE_ROOT/packaging/runtime/macos-arm64"
WORK="$TABLE_ROOT/packaging/work/pyinstaller-macos"
export PYINSTALLER_CONFIG_DIR="$TABLE_ROOT/packaging/cache/pyinstaller"
mkdir -p "$PYINSTALLER_CONFIG_DIR"

"$PYTHON" -m PyInstaller \
  --noconfirm \
  --clean \
  --onedir \
  --name mortal-engine \
  --paths "$BOT_ROOT" \
  --add-data "$BOT_ROOT/libriichi:libriichi" \
  --add-data "$BOT_ROOT/ot_settings.json:." \
  --distpath "$OUTPUT" \
  --workpath "$WORK" \
  --specpath "$TABLE_ROOT/packaging/work" \
  "$BOT_ROOT/bot_pool.py"

print "Mac Mortal engine: $OUTPUT/mortal-engine"
