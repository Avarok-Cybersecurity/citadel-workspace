#!/usr/bin/env bash
# Proves the app in the disk image does what a person opening it expects: it starts the agent,
# the agent answers the site's handshake, and quitting the app leaves nothing running.
#
#   scripts/smoke-macos-app.sh Citadel-Agent.dmg
#
# smoke-agent.sh already drives the agent binary inside the app; this drives the APP -- the
# launcher's arguments, its process handling, its quit -- which nothing else exercises.
#
# The app binds the port its Info.plist names. SMOKE_BIND replaces that in a copy, re-signed ad
# hoc, for a machine where the port is taken (a developer's, running the local stack); a release
# runner has the port free and tests the image exactly as published.
set -euo pipefail

DMG="${1:?usage: smoke-macos-app.sh <Citadel-Agent.dmg>}"
: "${EXPECTED_VERSION:?EXPECTED_VERSION must name the version the app must carry}"
[ -f "$DMG" ] || { echo "::error::no such image: $DMG" >&2; exit 1; }
WORK="$(mktemp -d)"
APP="$WORK/Citadel Agent.app"
BUNDLE_ID="net.avarok.citadel-agent"

running() { ps -axo comm | grep -cE "^$WORK/Citadel Agent.app/Contents/MacOS/(Citadel Agent|citadel-agent)$" || true; }
cleanup() {
  osascript -e "tell application id \"$BUNDLE_ID\" to quit" >/dev/null 2>&1 || true
  sleep 1
  pkill -f "$WORK/Citadel Agent.app/Contents/MacOS/" 2>/dev/null || true
  [ -d "$WORK/mnt" ] && hdiutil detach -quiet -force "$WORK/mnt" 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT

hdiutil attach -quiet -nobrowse -readonly -mountpoint "$WORK/mnt" "$DMG"
ditto "$WORK/mnt/Citadel Agent.app" "$APP"
hdiutil detach -quiet "$WORK/mnt"

if [ -n "${SMOKE_BIND:-}" ]; then
  plutil -replace CitadelAgentBind -string "$SMOKE_BIND" "$APP/Contents/Info.plist"
  xattr -cr "$APP"   # codesign refuses a bundle carrying Finder metadata
  codesign --force --sign - "$APP/Contents/MacOS/citadel-agent"
  codesign --force --sign - "$APP"
fi
BIND="$(plutil -extract CitadelAgentBind raw -o - "$APP/Contents/Info.plist")"
ORIGIN="$(plutil -extract CitadelWorkspaceOrigin raw -o - "$APP/Contents/Info.plist")"
PORT="${BIND##*:}"
# The version Finder shows, and "About", is the release's: the agent inside is checked by smoke-agent.sh.
for key in CFBundleShortVersionString CFBundleVersion; do
  v="$(plutil -extract "$key" raw -o - "$APP/Contents/Info.plist")"
  [ "$v" = "$EXPECTED_VERSION" ] || { echo "::error::the app's $key is '$v', expected $EXPECTED_VERSION" >&2; exit 1; }
done
"$(dirname "$0")/lib/assert-agent-version.sh" "$EXPECTED_VERSION" "$APP/Contents/MacOS/citadel-agent"
echo "  the app and its agent are version $EXPECTED_VERSION"

# A port already in use would let an agent that is not this app's answer every check below.
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "::error::port $PORT is already in use; this would test that listener, not the app. Set SMOKE_BIND." >&2
  exit 1
fi

open -n "$APP"
for _ in $(seq 1 60); do lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 && break; sleep 1; done
lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 \
  || { echo "::error::the app did not start the agent on $BIND within 60s" >&2; tail -20 ~/Library/Logs/Citadel\ Agent/agent.log >&2 || true; exit 1; }
echo "  the app started the agent on $BIND"

handshake() { "$(dirname "$0")/lib/agent-handshake.sh" "$PORT" "$1"; }
[ "$(handshake "$ORIGIN")" = 101 ] || { echo "::error::the agent refused the site's origin $ORIGIN" >&2; exit 1; }
[ "$(handshake https://evil.example)" = 403 ] || { echo "::error::the agent accepted a foreign origin" >&2; exit 1; }
echo "  it accepts $ORIGIN and refuses a foreign origin"

osascript -e "tell application id \"$BUNDLE_ID\" to quit"
for _ in $(seq 1 15); do [ "$(running)" = 0 ] && break; sleep 1; done
[ "$(running)" = 0 ] || { echo "::error::quitting the app left $(running) process(es) running" >&2; exit 1; }
! lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 \
  || { echo "::error::quitting the app left port $PORT open" >&2; exit 1; }
echo "  quitting it stops the agent and frees the port"
echo "== $DMG: the app runs the agent =="
