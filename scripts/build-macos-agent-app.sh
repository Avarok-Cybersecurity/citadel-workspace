#!/usr/bin/env bash
# Builds "Citadel Agent.app": one universal bundle, signed for distribution, not yet notarised.
#
#   SIGN_IDENTITY="Developer ID Application: ..." \
#     scripts/build-macos-agent-app.sh <agent-arm64> <agent-x86_64> <version> <out-dir>
#
# The agent binaries are the ones the release built for each architecture; they are joined into
# one, so nobody has to know which processor their Mac has (Safari will not say, so the download
# page cannot pick for them either). The launcher (apps/macos-agent) is compiled for both too.
#
# SIGN_IDENTITY has no default: an ad-hoc bundle would build, open on this machine, and be refused
# everywhere else.
set -euo pipefail

usage="usage: build-macos-agent-app.sh <agent-arm64> <agent-x86_64> <version> <out-dir>"
ARM="${1:?$usage}"; X64="${2:?$usage}"; VERSION="${3:?$usage}"; OUT="${4:?$usage}"
: "${SIGN_IDENTITY:?SIGN_IDENTITY must name the Developer ID Application identity}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/apps/macos-agent"
BRAND="$ROOT/assets/brand"

case "$VERSION" in
  [0-9]*.[0-9]*.[0-9]*) ;;
  *) echo "build-macos-agent-app: version must be MAJOR.MINOR.PATCH, got '$VERSION'" >&2; exit 1 ;;
esac
for f in "$ARM" "$X64"; do [ -f "$f" ] || { echo "build-macos-agent-app: no binary at $f" >&2; exit 1; }; done
# The architecture each argument claims, checked: swapped arguments would still lipo.
lipo "$ARM" -verify_arch arm64 || { echo "build-macos-agent-app: $ARM is not arm64" >&2; exit 1; }
lipo "$X64" -verify_arch x86_64 || { echo "build-macos-agent-app: $X64 is not x86_64" >&2; exit 1; }

APP="$OUT/Citadel Agent.app"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

# The agent. lipo drops each input's signature, so the joined binary is signed again below.
lipo -create "$ARM" "$X64" -output "$APP/Contents/MacOS/citadel-agent"

# The launcher, for both architectures. Swift 5 mode: the AppKit calls here are main-thread only,
# which Swift 6's strict concurrency checking cannot see through NSApplication's run loop.
for arch in arm64 x86_64; do
  swiftc -swift-version 5 -O -target "$arch-apple-macos13" \
    -framework AppKit -framework SwiftUI -framework ServiceManagement \
    "$SRC"/*.swift -o "$work/launcher-$arch"
done
lipo -create "$work/launcher-arm64" "$work/launcher-x86_64" -output "$APP/Contents/MacOS/Citadel Agent"

sed "s/__VERSION__/$VERSION/g" "$SRC/Info.plist" > "$APP/Contents/Info.plist"
plutil -lint "$APP/Contents/Info.plist" >/dev/null

# The icon: the brand kit's dark app icon (the guidelines' default), at every size an .icns holds.
"$ROOT/scripts/make-macos-icns.sh" "$BRAND" "$APP/Contents/Resources/AppIcon.icns"
# The menu-bar glyph: the kit's template cut (compact, black on clear), 16 pt at 1x and 2x.
# Tray.swift marks it isTemplate, so the system tints it for the menu bar's appearance.
cp "$BRAND/tray/tray-template-16.png" "$APP/Contents/Resources/tray-template.png"
cp "$BRAND/tray/tray-template-32.png" "$APP/Contents/Resources/tray-template@2x.png"
# The panel's title: the kit's -ondark horizontal lockup (the panel is the dark ground, #1C1D28).
# The transparent PNG carries its clear space (83 of 2048 px a side), so 32 pt tall draws the
# lockup itself 137 pt wide -- over its 120 px floor. The name is the kit's outlines, never retyped.
sips --resampleHeight 32 "$BRAND/transparent/logo-horizontal-1024-ondark.png" --out "$APP/Contents/Resources/lockup.png" >/dev/null
sips --resampleHeight 64 "$BRAND/transparent/logo-horizontal-2048-ondark.png" --out "$APP/Contents/Resources/lockup@2x.png" >/dev/null

# Inside out: the nested executable first, then the bundle, whose signature seals it. Not --deep,
# which signs nested code with the bundle's options and hides which piece a failure belongs to.
codesign --force --options runtime --timestamp --sign "$SIGN_IDENTITY" "$APP/Contents/MacOS/citadel-agent"
codesign --force --options runtime --timestamp --sign "$SIGN_IDENTITY" "$APP"
codesign --verify --deep --strict --verbose=2 "$APP"
echo "built: $APP ($VERSION, $(lipo -archs "$APP/Contents/MacOS/Citadel Agent"))"
