#!/bin/zsh

set -euo pipefail

NATIVE_DIR=${0:A:h}
ROOT=${NATIVE_DIR:h}
APP="$ROOT/Mortal麻将.app"

cd "$NATIVE_DIR"
export CLANG_MODULE_CACHE_PATH="$NATIVE_DIR/.build/clang-module-cache"
export SWIFTPM_MODULECACHE_OVERRIDE="$NATIVE_DIR/.build/swift-module-cache"
export XDG_CACHE_HOME="$NATIVE_DIR/.build/cache"
swift build --disable-sandbox -c release

mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$NATIVE_DIR/.build/release/MortalMahjong" "$APP/Contents/MacOS/MortalMahjong"
cp "$NATIVE_DIR/Info.plist" "$APP/Contents/Info.plist"
cp "$ROOT/assets/MortalMahjong-AppIcon.png" "$APP/Contents/Resources/AppIcon.png"

codesign --force --deep --sign - "$APP"
print "已生成：$APP"
