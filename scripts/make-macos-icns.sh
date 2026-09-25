#!/usr/bin/env bash
# Builds the macOS app icon (.icns) from the brand kit, reproducibly (sips + iconutil).
#
#   scripts/make-macos-icns.sh <assets/brand> <out.icns>
#
# The dark app icon is the guidelines' default. It places the mark at 56% of the canvas, so on a
# canvas under 57 px the mark itself is under 32 px -- where the guidelines require the compact
# cut. The 16 and 32 px slots therefore take the kit's own compact-cut dark squares
# (dark/favicon-16.png, dark/favicon-32.png) instead of a downscaled 1024, whose 14-unit stroke
# would render at about a pixel. Every other slot is the 1024 master resampled.
set -euo pipefail

usage="usage: make-macos-icns.sh <brand-dir> <out.icns>"
BRAND="${1:?$usage}"; OUT="${2:?$usage}"
MASTER="$BRAND/dark/app-icon-1024.png"
for f in "$MASTER" "$BRAND/dark/favicon-16.png" "$BRAND/dark/favicon-32.png"; do
  [ -f "$f" ] || { echo "make-macos-icns: missing $f" >&2; exit 1; }
done

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
iconset="$work/AppIcon.iconset"
mkdir -p "$iconset"

slot() { # <pixels> <name>
  case "$1" in
    16) cp "$BRAND/dark/favicon-16.png" "$iconset/$2" ;;
    32) cp "$BRAND/dark/favicon-32.png" "$iconset/$2" ;;
    *) sips -z "$1" "$1" "$MASTER" --out "$iconset/$2" >/dev/null ;;
  esac
}
for size in 16 32 128 256 512; do
  slot "$size" "icon_${size}x${size}.png"
  slot "$((size * 2))" "icon_${size}x${size}@2x.png"
done
iconutil -c icns "$iconset" -o "$OUT"
echo "built: $OUT"
