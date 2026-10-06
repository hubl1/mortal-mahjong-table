#!/bin/zsh

set -euo pipefail

SCRIPT_DIR=${0:A:h}
TABLE_ROOT=${SCRIPT_DIR:h:h}

cd "$TABLE_ROOT/vendor/Majiang-master"
npm run release

if ! "$TABLE_ROOT/.venv311/bin/python" -m PyInstaller --version >/dev/null 2>&1; then
  "$TABLE_ROOT/.venv311/bin/python" -m pip install 'pyinstaller>=6.11,<7'
fi
"$SCRIPT_DIR/build-mac-engine.sh"
"$SCRIPT_DIR/build-windows-python.sh"

cd "$TABLE_ROOT/electron-app"
npm install
npm run dist:mac
npm run pack:win

cd dist
ditto -c -k --sequesterRsrc --keepParent win-unpacked \
  "Mortal麻将-0.2.0-windows-x64-portable.zip"

print "构建完成：$TABLE_ROOT/electron-app/dist"
