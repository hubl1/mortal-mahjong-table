#!/bin/zsh

set -euo pipefail

SOURCE_DIR=${1:-}
PROJECT_DIR=${0:A:h:h}
OUTPUT_DIR="$PROJECT_DIR/dist/img/skin-unity"

if [[ -z "$SOURCE_DIR" ]]; then
    print -u2 "用法：$0 /path/to/OpenTiles/Regular"
    exit 2
fi
if [[ ! -f "$SOURCE_DIR/Front.png" || ! -f "$SOURCE_DIR/Back.png" ]]; then
    print -u2 "找不到 Unity 麻将牌素材：$SOURCE_DIR"
    exit 1
fi
if ! command -v magick >/dev/null; then
    print -u2 "需要 ImageMagick 的 magick 命令"
    exit 1
fi

mkdir -p "$OUTPUT_DIR"

make_face() {
    local source_name=$1
    local target_name=$2
    magick \
        "$SOURCE_DIR/Front.png" \
        "$SOURCE_DIR/$source_name.png" \
        -compose over -composite \
        -filter Lanczos -resize '240x336!' \
        -strip -define png:compression-level=9 \
        "$OUTPUT_DIR/$target_name.png"
}

for number in {1..9}; do
    make_face "Man$number" "m$number"
    make_face "Pin$number" "p$number"
    make_face "Sou$number" "s$number"
done

make_face "Man5-Dora" m0
make_face "Pin5-Dora" p0
make_face "Sou5-Dora" s0

typeset -a honor_sources=(Ton Nan Shaa Pei Haku Hatsu Chun)
for number in {1..7}; do
    make_face "$honor_sources[$number]" "z$number"
done

magick "$SOURCE_DIR/Back.png" \
    -filter Lanczos -resize '240x336!' \
    -strip -define png:compression-level=9 \
    "$OUTPUT_DIR/back.png"

print "已生成 Unity 牌皮肤：$OUTPUT_DIR"
