#!/usr/bin/env bash
# Packages a signed agent binary as a signed disk image, for notarise-macos.sh to notarise and staple.
#
#   SIGN_IDENTITY="Developer ID Application: ..." \
#     scripts/package-macos-dmg.sh <signed-binary> <readme> <out.dmg>
#
# Why a disk image and not only the .tar.gz: a notarisation ticket can be stapled to a .dmg, never
# to a bare executable. A bare binary is judged online on first run, and a quarantined one that
# Gatekeeper cannot vouch for offline is presented as software from an unidentified developer --
# which is exactly how a signed, notarised download read to its first user. The stapled image is
# cleared on first open with no network and no warning beyond the ordinary "downloaded from the
# Internet" confirmation.
#
# SIGN_IDENTITY has no default: an image signed ad hoc would look packaged and be refused.
set -euo pipefail

BIN="${1:?usage: package-macos-dmg.sh <signed-binary> <readme> <out.dmg>}"
README="${2:?usage: package-macos-dmg.sh <signed-binary> <readme> <out.dmg>}"
OUT="${3:?usage: package-macos-dmg.sh <signed-binary> <readme> <out.dmg>}"
: "${SIGN_IDENTITY:?SIGN_IDENTITY must name the Developer ID Application identity}"

[ -f "$BIN" ] || { echo "package-macos-dmg: no binary at $BIN" >&2; exit 1; }
[ -f "$README" ] || { echo "package-macos-dmg: no README at $README" >&2; exit 1; }

# The binary must already carry the distribution signature; the image vouches for what it holds.
# Captured before matching: piping codesign into an early-exiting filter can SIGPIPE it.
sig="$(codesign -dv --verbose=2 "$BIN" 2>&1)"
case "$sig" in
  *"Authority=Developer ID Application"*) ;;
  *) echo "package-macos-dmg: $BIN is not signed with a Developer ID Application identity" >&2; exit 1 ;;
esac
case "$sig" in
  *"(runtime)"*) ;;
  *) echo "package-macos-dmg: $BIN lacks the hardened runtime; notarisation would reject it" >&2; exit 1 ;;
esac

staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT
# ditto, not cp: it preserves the signature's extended attributes and the mode bit.
ditto "$BIN" "$staging/citadel-agent"
cp "$README" "$staging/README.md"

rm -f "$OUT"
hdiutil create -quiet -volname "Citadel Agent" -srcfolder "$staging" -fs HFS+ -format UDZO "$OUT"
codesign --force --timestamp --sign "$SIGN_IDENTITY" "$OUT"
codesign --verify --strict --verbose=2 "$OUT"
