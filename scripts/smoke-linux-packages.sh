#!/usr/bin/env bash
# Proves the Linux one-click packages start a working agent the way a user's desktop starts them.
#
#   EXPECTED_VERSION=X.Y.Z scripts/smoke-linux-packages.sh <citadel-agent_*.deb> <Citadel-Agent-*.AppImage>
#
# The .deb: installed with dpkg -i; the agent and launcher print the expected --version; the
# menu entry and the login entry run the same command; that command, run as a desktop session
# would, listens on the bind the Mac app uses, answers the site's handshake with 101, refuses a
# foreign origin, and keeps the account under $HOME; removal leaves none of it behind.
# The AppImage: the same, through --appimage-extract-and-run (no FUSE on a runner), plus its
# offer to start at login.
#
# Needs root or sudo for dpkg, and the port the packages bind free: an agent already there
# would answer every check for them.
set -euo pipefail

usage="usage: smoke-linux-packages.sh <deb> <AppImage>"
DEB="${1:?$usage}"; AI="${2:?$usage}"
: "${EXPECTED_VERSION:?EXPECTED_VERSION must name the version the agent must print}"
for f in "$DEB" "$AI"; do [ -f "$f" ] || { echo "::error::no such package: $f" >&2; exit 1; }; done
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LIB="$ROOT/scripts/lib"
setting() { python3 "$LIB/agent-settings.py" "$ROOT/apps/macos-agent/Info.plist" get "$1"; }
ORIGIN="$(setting CitadelWorkspaceOrigin)"
PORT="$(setting CitadelAgentBind)"; PORT="${PORT##*:}"
DATA_DIR_NAME="$(setting CitadelAgentDataDirectoryName)"
SUDO=""; [ "$(id -u)" = 0 ] || SUDO="sudo"
AI="$(readlink -f "$AI")"

WORK="$(mktemp -d)"
AGENT_PGID=""
cleanup() {
  [ -n "$AGENT_PGID" ] && kill -- "-$AGENT_PGID" 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT

listening() { python3 -c "
import socket,sys
s=socket.socket(); s.settimeout(0.4)
sys.exit(0 if s.connect_ex(('127.0.0.1',$PORT))==0 else 1)"; }
fail() { echo "::error::$*" >&2; [ -f "$WORK/agent.log" ] && tail -20 "$WORK/agent.log" >&2; exit 1; }

# Starts <command...> as a login session would (its own process group, a fresh HOME), and
# requires the agent it starts to serve the site and keep its account in that HOME.
drive() { # <label> <command...>
  local label="$1"; shift
  local home="$WORK/home-$label"
  mkdir -p "$home"
  listening && fail "port $PORT is already in use; that listener, not the $label, would answer"
  HOME="$home" setsid "$@" >"$WORK/agent.log" 2>&1 &
  AGENT_PGID=$!
  for _ in $(seq 1 60); do
    listening && break
    kill -0 "$AGENT_PGID" 2>/dev/null || fail "the $label's agent exited while starting"
    sleep 1
  done
  listening || fail "the $label's agent did not listen on 127.0.0.1:$PORT within 60s"
  echo "  $label: the agent listens on 127.0.0.1:$PORT"
  local got
  got="$("$LIB/agent-handshake.sh" "$PORT" "$ORIGIN")"
  [ "$got" = 101 ] || fail "the $label's agent answered the handshake from $ORIGIN with '$got', not 101"
  got="$("$LIB/agent-handshake.sh" "$PORT" https://evil.example)"
  [ "$got" = 403 ] || fail "the $label's agent answered a foreign origin with '$got', not 403"
  echo "  $label: 101 for $ORIGIN, 403 for a foreign origin"
  [ -d "$home/$DATA_DIR_NAME" ] || fail "the $label's agent did not keep its account in \$HOME/$DATA_DIR_NAME"
  echo "  $label: the account is kept in \$HOME/$DATA_DIR_NAME"
  kill -- "-$AGENT_PGID"
  for _ in $(seq 1 15); do listening || break; sleep 1; done
  listening && fail "stopping the $label left port $PORT open"
  AGENT_PGID=""
}

exec_line() { # <desktop file> -> its Exec value
  local line
  line="$(grep -E '^Exec=' "$1")" || fail "$1 has no Exec line"
  [ "$(printf '%s\n' "$line" | wc -l)" -eq 1 ] || fail "$1 has more than one Exec line"
  printf '%s' "${line#Exec=}"
}

echo "== $DEB =="
$SUDO dpkg -i "$DEB" >/dev/null
[ -x /usr/bin/citadel-agent ] || fail "the .deb did not install /usr/bin/citadel-agent"
"$LIB/assert-agent-version.sh" "$EXPECTED_VERSION" /usr/bin/citadel-agent
"$LIB/assert-agent-version.sh" "$EXPECTED_VERSION" /usr/bin/citadel-agent-launch
AUTOSTART=/etc/xdg/autostart/citadel-agent.desktop
MENU=/usr/share/applications/citadel-agent.desktop
EXEC="$(exec_line "$AUTOSTART")"
[ "$EXEC" = "$(exec_line "$MENU")" ] || fail "the menu entry and the login entry run different commands"
command -v desktop-file-validate >/dev/null && desktop-file-validate "$AUTOSTART" "$MENU"
# The Exec value holds no field codes, so a shell runs it as the session would.
drive deb sh -c "exec $EXEC"
$SUDO dpkg --purge citadel-agent >/dev/null
for f in /usr/bin/citadel-agent /usr/bin/citadel-agent-launch "$AUTOSTART" "$MENU"; do
  [ ! -e "$f" ] || fail "removing the .deb left $f behind"
done
echo "  deb: removed cleanly"

echo "== $AI =="
[ -x "$AI" ] || fail "$AI is not executable"
"$LIB/assert-agent-version.sh" "$EXPECTED_VERSION" "$AI" --appimage-extract-and-run
drive appimage "$AI" --appimage-extract-and-run
entry="$WORK/home-appimage/.config/autostart/citadel-agent-appimage.desktop"
HOME="$WORK/home-appimage" XDG_CONFIG_HOME="$WORK/home-appimage/.config" "$AI" --appimage-extract-and-run --install-autostart >/dev/null
[ "$(exec_line "$entry")" = "\"$AI\"" ] || fail "the AppImage's login entry does not run it: $(exec_line "$entry")"
HOME="$WORK/home-appimage" XDG_CONFIG_HOME="$WORK/home-appimage/.config" "$AI" --appimage-extract-and-run --remove-autostart >/dev/null
[ ! -e "$entry" ] || fail "--remove-autostart left $entry"
echo "  appimage: offers to start at login, and takes it back"
echo "== the .deb and the AppImage run the agent =="
