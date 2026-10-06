#!/bin/zsh

set -euo pipefail

SCRIPT_DIR=${0:A:h}
TABLE_ROOT=${SCRIPT_DIR:h:h}
BUILDER_PYTHON="$TABLE_ROOT/.venv311/bin/python"
OUTPUT="$TABLE_ROOT/packaging/runtime/windows-x64/python"
ARCHIVE="$TABLE_ROOT/packaging/runtime/python-3.11.9-embed-amd64.zip"
URL="https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip"

mkdir -p "$TABLE_ROOT/packaging/runtime/windows-x64"
if [[ ! -f "$ARCHIVE" ]]; then
  curl -fL "$URL" -o "$ARCHIVE"
fi

rm -rf "$OUTPUT"
mkdir -p "$OUTPUT/Lib/site-packages"
ditto -x -k "$ARCHIVE" "$OUTPUT"

"$BUILDER_PYTHON" -m pip install \
  --target "$OUTPUT/Lib/site-packages" \
  --platform win_amd64 \
  --python-version 3.11 \
  --implementation cp \
  --abi cp311 \
  --only-binary=:all: \
  --index-url https://download.pytorch.org/whl/cpu \
  --extra-index-url https://pypi.org/simple \
  'torch==2.8.0' 'numpy==2.3.3' 'requests>=2.28'

# The Windows wheel contains multi-gigabyte static import libraries and C++
# headers for extension developers. Mortal only needs the runtime DLLs.
find "$OUTPUT/Lib/site-packages/torch" -type f -name '*.lib' -delete
rm -rf "$OUTPUT/Lib/site-packages/torch/include"

printf '%s\n' \
  'python311.zip' \
  '.' \
  'Lib/site-packages' \
  '../../bot' \
  'import site' > "$OUTPUT/python311._pth"

print "Windows embedded Python: $OUTPUT"
