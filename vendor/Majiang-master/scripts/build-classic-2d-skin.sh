#!/bin/zsh

set -euo pipefail

SOURCE_DIR=${1:-}
PROJECT_DIR=${0:A:h:h}
OUTPUT_DIR="$PROJECT_DIR/dist/img/skin-classic2d"
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

if [[ -z "$SOURCE_DIR" ]]; then
    print -u2 "用法：$0 /path/to/OpenTiles/Regular"
    exit 2
fi
if [[ ! -f "$SOURCE_DIR/Man1.png" || ! -f "$SOURCE_DIR/Sou1.png" ]]; then
    print -u2 "找不到 OpenTiles/Regular 图案：$SOURCE_DIR"
    exit 1
fi
if ! command -v magick >/dev/null; then
    print -u2 "需要 ImageMagick 的 magick 命令"
    exit 1
fi

mkdir -p "$OUTPUT_DIR"

# Flat ivory face with a visible neutral outline.  There are deliberately no
# bevels, highlights, gradients, or shadows.
magick -size '600x840' xc:none \
    -fill '#f8f7f3' -stroke '#92999c' -strokewidth 10 \
    -draw 'roundrectangle 10,10 589,829 40,40' \
    "$TEMP_DIR/front.png"

make_face() {
    local source_name=$1
    local target_name=$2
    local artwork="$TEMP_DIR/$target_name-artwork.png"

    # Keep the traditional artwork comfortably inside the tile instead of
    # letting it fill the complete face as in the original Unity sprites.
    magick "$SOURCE_DIR/$source_name.png" \
        -filter Lanczos -resize '510x680!' \
        "$artwork"
    magick "$TEMP_DIR/front.png" "$artwork" \
        -geometry '+45+80' -compose over -composite \
        -depth 8 -strip -define png:compression-level=9 \
        "$OUTPUT_DIR/$target_name.png"
}

for number in {1..9}; do
    make_face "Man$number" "m$number"
    make_face "Pin$number" "p$number"
    make_face "Sou$number" "s$number"
done

make_face 'Man5-Dora' m0
make_face 'Pin5-Dora' p0
make_face 'Sou5-Dora' s0

typeset -a honor_sources=(Ton Nan Shaa Pei Haku Hatsu Chun)
for number in {1..7}; do
    make_face "$honor_sources[$number]" "z$number"
done

# Classic flat yellow back; keep the same silhouette as the face.
magick -size '600x840' xc:none \
    -fill '#e8b23f' -stroke '#8a661f' -strokewidth 12 \
    -draw 'roundrectangle 10,10 589,829 40,40' \
    -depth 8 -strip -define png:compression-level=9 \
    "$OUTPUT_DIR/back.png"

print "已生成传统配色平面 2D 皮肤：$OUTPUT_DIR"
