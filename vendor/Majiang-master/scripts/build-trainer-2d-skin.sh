#!/bin/zsh

set -euo pipefail

SOURCE_DIR=${1:-}
PROJECT_DIR=${0:A:h:h}
OUTPUT_DIR="$PROJECT_DIR/dist/img/skin-trainer2d"
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

if [[ -z "$SOURCE_DIR" ]]; then
    print -u2 "用法：$0 /path/to/MahjongTrainer2D/Tiles/PngNormal"
    exit 2
fi
if [[ ! -f "$SOURCE_DIR/tile_00.png" || ! -f "$SOURCE_DIR/tile_33.png" ]]; then
    print -u2 "找不到 MahjongTrainer2D 原始牌图：$SOURCE_DIR"
    exit 1
fi
if ! command -v magick >/dev/null; then
    print -u2 "需要 ImageMagick 的 magick 命令"
    exit 1
fi

mkdir -p "$OUTPUT_DIR"

# The original assets contain only the navy symbol and outline.  Add a plain
# ivory fill behind them—no bevel, highlight, shadow, or gradient.
magick -size '135x178' xc:none \
    -fill '#faf9f5' -stroke none \
    -draw 'roundrectangle 1,1 133,176 8,8' \
    "$TEMP_DIR/front.png"

make_tile() {
    local index=$1
    local target=$2
    local overlay=${3:-$SOURCE_DIR/tile_$index.png}
    magick "$TEMP_DIR/front.png" "$overlay" \
        -compose over -composite \
        -filter Lanczos -resize '240x336!' \
        -strip -define png:compression-level=9 \
        "$OUTPUT_DIR/$target.png"
}

for number in {1..9}; do
    printf -v man_index '%02d' $((number - 1))
    printf -v pin_index '%02d' $((number + 8))
    printf -v sou_index '%02d' $((number + 17))
    make_tile "$man_index" "m$number"
    make_tile "$pin_index" "p$number"
    make_tile "$sou_index" "s$number"
done

for number in {1..7}; do
    printf -v honor_index '%02d' $((number + 26))
    make_tile "$honor_index" "z$number"
done

make_red_five() {
    local index=$1
    local target=$2
    local source="$SOURCE_DIR/tile_$index.png"
    local recolored="$TEMP_DIR/$target.png"

    # Recolor the artwork, then restore the four outer strips from the
    # original asset so the navy frame remains untouched.
    magick "$source" -fill '#cf2638' -colorize 100 "$recolored"
    magick "$recolored" \
        \( "$source" -crop '135x12+0+0' +repage \) -geometry '+0+0' -composite \
        \( "$source" -crop '135x12+0+166' +repage \) -geometry '+0+166' -composite \
        \( "$source" -crop '12x154+0+12' +repage \) -geometry '+0+12' -composite \
        \( "$source" -crop '13x154+122+12' +repage \) -geometry '+122+12' -composite \
        "$recolored"
    make_tile "$index" "$target" "$recolored"
}

make_red_five 04 m0
make_red_five 13 p0
make_red_five 22 s0

# Flat classic-yellow back matching the face outline.  Intentionally no
# lighting effects.
magick -size '240x336' xc:none \
    -fill '#e8b23f' -stroke '#8a661f' -strokewidth 5 \
    -draw 'roundrectangle 4,4 235,331 16,16' \
    -strip -define png:compression-level=9 \
    "$OUTPUT_DIR/back.png"

print "已生成 MahjongTrainer2D 原始 2D 皮肤：$OUTPUT_DIR"
