#!/usr/bin/env bash
# Packages a built Linux agent as a .deb and an AppImage, the two one-click installs.
#
#   APPIMAGETOOL=/path/appimagetool APPIMAGE_RUNTIME=/path/runtime-<arch> \
#     scripts/package-linux-agent.sh <citadel-agent binary> <version> <out-dir>
#
# Writes <out-dir>/citadel-agent_<version>_<deb-arch>.deb and <out-dir>/Citadel-Agent-<arch>.AppImage.
#
# Both carry the agent unchanged at usr/bin/citadel-agent and, beside it, citadel-agent-launch:
# the wrapper that supplies the flags (packaging/linux/citadel-agent-launch.in, rendered from
# apps/macos-agent/Info.plist). The .deb adds a menu entry and a login entry
# (/etc/xdg/autostart) that both run the wrapper; the AppImage's AppRun IS the wrapper.
#
# The architecture comes from the binary, not an argument, so a name cannot claim another.
# APPIMAGETOOL and APPIMAGE_RUNTIME have no defaults: appimagetool otherwise downloads a runtime
# of its choosing at build time, which would put an unpinned binary inside every AppImage.
set -euo pipefail

usage="usage: package-linux-agent.sh <citadel-agent> <version> <out-dir>"
BIN="${1:?$usage}"; VERSION="${2:?$usage}"; OUT="${3:?$usage}"
: "${APPIMAGETOOL:?APPIMAGETOOL must name the pinned appimagetool}"
: "${APPIMAGE_RUNTIME:?APPIMAGE_RUNTIME must name the pinned AppImage type2 runtime}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SETTINGS="$ROOT/apps/macos-agent/Info.plist"
ICON="$ROOT/assets/brand/transparent/icon-512.png"

[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "package-linux-agent: version must be MAJOR.MINOR.PATCH, got '$VERSION'" >&2; exit 1; }
[ -f "$BIN" ] || { echo "package-linux-agent: no binary at $BIN" >&2; exit 1; }
case "$(file -b "$BIN")" in
  *ELF*x86-64*)  DEB_ARCH=amd64; AI_ARCH=x86_64 ;;
  *ELF*aarch64*) DEB_ARCH=arm64; AI_ARCH=aarch64 ;;
  *) echo "package-linux-agent: $BIN is not a Linux x86-64 or aarch64 executable: $(file -b "$BIN")" >&2; exit 1 ;;
esac

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$OUT"
DEB="$OUT/citadel-agent_${VERSION}_${DEB_ARCH}.deb"
APPIMAGE="$OUT/Citadel-Agent-${AI_ARCH}.AppImage"

python3 "$ROOT/scripts/lib/agent-settings.py" "$SETTINGS" render \
  "$ROOT/packaging/linux/citadel-agent-launch.in" > "$work/citadel-agent-launch"
sh -n "$work/citadel-agent-launch"

desktop_entry() { # <Exec value>
  cat <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=Citadel Agent
Comment=The local agent Citadel Workspace connects to
Exec=$1
Icon=citadel-agent
Terminal=false
Categories=Network;
X-GNOME-Autostart-enabled=true
EOF
}

# The payload both formats share.
stage() { # <root>
  install -Dm0755 "$BIN" "$1/usr/bin/citadel-agent"
  install -Dm0755 "$work/citadel-agent-launch" "$1/usr/bin/citadel-agent-launch"
  install -Dm0644 "$ICON" "$1/usr/share/icons/hicolor/512x512/apps/citadel-agent.png"
  install -Dm0644 "$ROOT/docs/AGENT_README.md" "$1/usr/share/doc/citadel-agent/README.md"
}

# --- .deb -------------------------------------------------------------------------------------
deb="$work/deb"
stage "$deb"
desktop_entry /usr/bin/citadel-agent-launch > "$work/citadel-agent.desktop"
install -Dm0644 "$work/citadel-agent.desktop" "$deb/usr/share/applications/citadel-agent.desktop"
# Every user's login session starts it, as the Mac app's login item does for its user.
install -Dm0644 "$work/citadel-agent.desktop" "$deb/etc/xdg/autostart/citadel-agent.desktop"
mkdir -p "$deb/DEBIAN"
# /etc/xdg/autostart is a conffile: dpkg keeps an administrator's edit (or removal) of it.
echo /etc/xdg/autostart/citadel-agent.desktop > "$deb/DEBIAN/conffiles"
cat > "$deb/DEBIAN/control" <<EOF
Package: citadel-agent
Version: $VERSION
Architecture: $DEB_ARCH
Maintainer: Thomas Braun <thomas@avarok.net>
Section: net
Priority: optional
Depends: libc6, libgcc-s1
Homepage: https://github.com/Avarok-Cybersecurity/citadel-workspace
Installed-Size: $(du -sk "$deb/usr" | cut -f1)
Description: The local agent Citadel Workspace connects to
 Runs on your own machine and holds your Citadel protocol connections. The
 browser talks to it over a WebSocket on 127.0.0.1; it starts when you log in.
EOF
dpkg-deb --root-owner-group -Zxz --build "$deb" "$DEB" >/dev/null
echo "built: $DEB"

# --- AppImage ---------------------------------------------------------------------------------
appdir="$work/Citadel-Agent.AppDir"
stage "$appdir"
# AppRun is the wrapper, by symlink: it resolves its own path and finds the agent beside it.
ln -s usr/bin/citadel-agent-launch "$appdir/AppRun"
desktop_entry citadel-agent-launch > "$appdir/citadel-agent.desktop"
cp "$ICON" "$appdir/citadel-agent.png"
ARCH="$AI_ARCH" "$APPIMAGETOOL" --no-appstream --runtime-file "$APPIMAGE_RUNTIME" \
  "$appdir" "$APPIMAGE" >"$work/appimagetool.log" 2>&1 \
  || { cat "$work/appimagetool.log" >&2; exit 1; }
chmod 0755 "$APPIMAGE"
echo "built: $APPIMAGE"
