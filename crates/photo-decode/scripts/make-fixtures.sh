#!/usr/bin/env bash
# Regenerates tests/fixtures. macOS only: Apple's `sips` encodes JPEG, TIFF and BMP from a PNG
# that scripts/gen-quadrants.py writes pixel by pixel (stdlib only). No third-party image data.
# The two HEIC files are copied from heic-rs's own generated fixtures (MIT OR Apache-2.0).
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
out="$here/tests/fixtures"
heic="${HEIC_RS:-$HOME/avarok/heic-rs}/tests/fixtures"
mkdir -p "$out"
python3 -I "$here/scripts/gen-quadrants.py" "$out/quadrants-48.png"
sips -s format jpeg -s formatOptions 90 "$out/quadrants-48.png" --out "$out/quadrants-48.jpg" >/dev/null
sips -s format tiff -s formatOptions lzw "$out/quadrants-48.png" --out "$out/quadrants-48-lzw.tif" >/dev/null
sips -s format bmp "$out/quadrants-48.png" --out "$out/quadrants-48.bmp" >/dev/null
python3 -I "$here/scripts/gen-turned.py" "$out"
cp "$heic/checker-64.heic" "$heic/checker-64.ref.png" "$out/"
ls -l "$out"
