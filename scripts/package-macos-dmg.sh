#!/usr/bin/env bash
# Packages "Citadel Agent.app" as the disk image people download: open it, and the window shows
# the app beside Applications over the branded background, to be dragged across.
#
#   SIGN_IDENTITY="Developer ID Application: ..." DMGBUILD=<path to dmgbuild> \
#     scripts/package-macos-dmg.sh "<dir>/Citadel Agent.app" <out.dmg>
#
# The app is expected notarised and stapled already (notarise-macos.sh), so that once dragged out
# of the image it carries its own ticket; the image is notarised and stapled after this, as well.
#
# SIGN_IDENTITY and DMGBUILD have no defaults: an unsigned image would be refused on every Mac but
# this one, and a guessed dmgbuild is how a window ships without its layout.
set -euo pipefail

APP="${1:?usage: package-macos-dmg.sh <app> <out.dmg>}"
OUT="${2:?usage: package-macos-dmg.sh <app> <out.dmg>}"
: "${SIGN_IDENTITY:?SIGN_IDENTITY must name the Developer ID Application identity}"
: "${DMGBUILD:?DMGBUILD must name the dmgbuild executable}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/apps/macos-agent"

[ -d "$APP" ] || { echo "package-macos-dmg: no app at $APP" >&2; exit 1; }
# The image vouches for what it holds, so what it holds must already be signed for distribution.
codesign --verify --deep --strict "$APP" || { echo "package-macos-dmg: $APP is not validly signed" >&2; exit 1; }
sig="$(codesign -dv --verbose=2 "$APP" 2>&1)"
case "$sig" in
  *"Authority=Developer ID Application"*) ;;
  *) echo "package-macos-dmg: $APP is not signed with a Developer ID Application identity" >&2; exit 1 ;;
esac

rm -f "$OUT"
"$DMGBUILD" -s "$SRC/dmg-settings.py" -D app="$APP" -D background="$SRC/dmg-background.tiff" \
  "Citadel Agent" "$OUT"
# No hardened runtime: a disk image is not code.
codesign --force --timestamp --sign "$SIGN_IDENTITY" "$OUT"
codesign --verify --strict --verbose=2 "$OUT"
