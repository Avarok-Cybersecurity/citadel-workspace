#!/usr/bin/env bash
# Proves a packaged agent archive actually runs before it is published.
#
# Building successfully and shipping something usable are different claims. A
# release can carry a binary that is the wrong architecture, was linked against
# something absent on a clean machine, or lost its executable bit in packaging —
# all of which build green and fail in the user's hands, which is the worst place
# to find out.
#
# So this unpacks the artifact the way a user would and drives it:
#   1. the archive contains the binary and the README;
#   2. the binary is executable and refuses to start without --bind, proving the
#      CLI is intact rather than a stub that exits 0;
#   3. it actually LISTENS on a port when asked.
#
# (3) is the one that matters. The others can pass on a binary that cannot serve.
set -euo pipefail

ARCHIVE="${1:?usage: smoke-agent.sh <archive.tar.gz>}"
[ -f "$ARCHIVE" ] || { echo "::error::no such archive: $ARCHIVE" >&2; exit 1; }

WORK="$(mktemp -d)"
cleanup() {
  [ -n "${AGENT_PID:-}" ] && kill "$AGENT_PID" 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT

case "$ARCHIVE" in
  *.zip)    unzip -q "$ARCHIVE" -d "$WORK"; BIN="$WORK/citadel-agent.exe" ;;
  *.tar.gz) tar -xzf "$ARCHIVE" -C "$WORK"; BIN="$WORK/citadel-agent" ;;
  *)        echo "::error::unknown archive type: $ARCHIVE" >&2; exit 1 ;;
esac

[ -f "$BIN" ]            || { echo "::error::archive has no $(basename "$BIN")" >&2; ls -la "$WORK" >&2; exit 1; }
[ -f "$WORK/README.md" ] || { echo "::error::archive ships no README; a user gets a bare binary with a required flag and no way to know it" >&2; exit 1; }
# Windows has no executable bit; the check is meaningful only where it exists.
case "$ARCHIVE" in
  *.tar.gz) [ -x "$BIN" ] || { echo "::error::citadel-agent is not executable — packaging dropped the mode bit" >&2; exit 1; } ;;
esac

# No --bind must FAIL. A binary that exits 0 here is not our agent, or is a stub.
if "$BIN" >/dev/null 2>&1; then
  echo "::error::agent exited 0 with no --bind; it should refuse to start" >&2
  exit 1
fi

# The asset NAME is a promise about the architecture inside, and the UI relies on
# it: macOS users are offered "Apple Silicon" and "Intel" as separate downloads
# precisely because we refuse to guess for them. A matrix entry pointing the
# wrong target at the wrong asset name would hand an Intel binary to an ARM Mac,
# which fails only after the download and reads as a broken release.
case "$ARCHIVE" in
  *macos-arm64*) WANT="arm64" ;;
  *macos-x64*)   WANT="x86_64" ;;
  *linux-x64*)   WANT="x86-64" ;;
  *windows-x64*) WANT="x86-64" ;;
  *)             WANT="" ;;
esac
if [ -n "$WANT" ]; then
  DESC="$(file -b "$BIN")"
  case "$DESC" in
    *"$WANT"*) echo "  architecture matches the asset name ($WANT)" ;;
    *) echo "::error::$ARCHIVE claims $WANT but the binary is: $DESC" >&2; exit 1 ;;
  esac
fi

# Pick a free port rather than hardcoding 12345, so this never collides with a
# real agent already running on the machine doing the release.
PORT="$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')"

"$BIN" --bind "127.0.0.1:$PORT" --backend in-memory >"$WORK/agent.log" 2>&1 &
AGENT_PID=$!

for _ in $(seq 1 60); do
  if ! kill -0 "$AGENT_PID" 2>/dev/null; then
    echo "::error::agent exited while starting up:" >&2
    tail -20 "$WORK/agent.log" >&2
    exit 1
  fi
  if python3 -c "
import socket,sys
s=socket.socket(); s.settimeout(0.4)
sys.exit(0 if s.connect_ex(('127.0.0.1',$PORT))==0 else 1)
" 2>/dev/null; then
    echo "  agent listens on 127.0.0.1:$PORT"
    echo "== $ARCHIVE is runnable =="
    exit 0
  fi
  sleep 1
done

echo "::error::agent never listened on 127.0.0.1:$PORT within 60s" >&2
tail -20 "$WORK/agent.log" >&2
exit 1
