#!/bin/zsh

set -euo pipefail

if [[ $# -ne 1 ]]; then
    print -u2 "用法：$0 /path/to/mahjong-tiles-main"
    exit 1
fi

SOURCE_ROOT=$1
SOURCE_DIR="$SOURCE_ROOT/tiles"
PROJECT_DIR=${0:A:h:h}
OUTPUT_DIR="$PROJECT_DIR/dist/img/skin-flat"
YELLOW_BACK="$PROJECT_DIR/dist/img/skin-unity/back.png"

if [[ ! -f "$SOURCE_DIR/1m.png" || ! -f "$SOURCE_ROOT/LICENSE" ]]; then
    print -u2 "不是有效的 zddd312/mahjong-tiles 目录：$SOURCE_ROOT"
    exit 1
fi
if [[ ! -f "$YELLOW_BACK" ]]; then
    print -u2 "找不到现有黄色牌背：$YELLOW_BACK"
    exit 1
fi
if ! command -v magick >/dev/null; then
    print -u2 "需要 ImageMagick 的 magick 命令"
    exit 1
fi

mkdir -p "$OUTPUT_DIR"

resize_tile() {
    magick "$1" \
        -filter Lanczos -resize '240x336!' \
        -strip -define png:compression-level=9 "$2"
}

for suit in m p s; do
    for number in {1..9}; do
        resize_tile "$SOURCE_DIR/$number$suit.png" \
                    "$OUTPUT_DIR/$suit$number.png"
    done
done

# Source honors use East, South, West, North, Red, Green, White.  MPSZ uses
# East, South, West, North, White, Green, Red.
for number in {1..4}; do
    resize_tile "$SOURCE_DIR/z$number.png" "$OUTPUT_DIR/z$number.png"
done
resize_tile "$SOURCE_DIR/z7.png" "$OUTPUT_DIR/z5.png"
resize_tile "$SOURCE_DIR/z6.png" "$OUTPUT_DIR/z6.png"
resize_tile "$SOURCE_DIR/z5.png" "$OUTPUT_DIR/z7.png"

make_red_five() {
    local source=$1
    local target=$2
    local primary=$3
    local secondary=$4
    magick "$source" \
        -fuzz 12% -fill '#d7192d' -opaque "$primary" \
        -fuzz 12% -fill '#d7192d' -opaque "$secondary" \
        -filter Lanczos -resize '240x336!' \
        -strip -define png:compression-level=9 "$target"
}

make_red_five "$SOURCE_DIR/5m.png" "$OUTPUT_DIR/m0.png" '#000000' '#801820'
make_red_five "$SOURCE_DIR/5p.png" "$OUTPUT_DIR/p0.png" '#091733' '#871B20'
make_red_five "$SOURCE_DIR/5s.png" "$OUTPUT_DIR/s0.png" '#005528' '#871B20'

cp "$YELLOW_BACK" "$OUTPUT_DIR/back.png"
cp "$SOURCE_ROOT/LICENSE" "$OUTPUT_DIR/LICENSE.txt"

print "已导入平面 2D 牌皮肤：$OUTPUT_DIR"
