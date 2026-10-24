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

ARCHIVE="${1:?usage: smoke-agent.sh <archive.tar.gz|.zip|.dmg>}"
# The version this artefact must report: the tag's on a release, Cargo.toml's on a dispatch
# (scripts/release-version.sh). No default: a smoke that skipped it would pass a stale binary.
: "${EXPECTED_VERSION:?EXPECTED_VERSION must name the version the agent must print}"
[ -f "$ARCHIVE" ] || { echo "::error::no such archive: $ARCHIVE" >&2; exit 1; }

WORK="$(mktemp -d)"
# shellcheck disable=SC2329 # run by the EXIT trap below
cleanup() {
  [ -n "${AGENT_PID:-}" ] && kill "$AGENT_PID" 2>/dev/null || true
  # A copy that fails under set -e exits before the detach below; a mounted image would outlive us.
  [ -d "$WORK/mnt" ] && hdiutil detach -quiet -force "$WORK/mnt" 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT

# The checks live beside this entry point, each sourced into this shell: they share its
# variables, and an `exit` in one ends the smoke.
LIB="$(dirname "$0")/lib"

# shellcheck source=scripts/lib/smoke-unpack.sh
. "$LIB/smoke-unpack.sh"

# No --bind must FAIL. A binary that exits 0 here is not our agent, or is a stub.
if "$BIN" >/dev/null 2>&1; then
  echo "::error::agent exited 0 with no --bind; it should refuse to start" >&2
  exit 1
fi
"$LIB/assert-agent-version.sh" "$EXPECTED_VERSION" "$BIN"

# shellcheck source=scripts/lib/smoke-architecture.sh
. "$LIB/smoke-architecture.sh"

# Pick a free port rather than hardcoding 12345, so this never collides with a
# real agent already running on the machine doing the release.
PORT="$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')"

# The allowlist is REQUIRED by the WebSocket agent (it refuses to start without one); the
# handshake below presents this origin, and a foreign one, to prove the policy shipped.
INTERNAL_SERVICE_ALLOWED_ORIGINS="http://localhost:5291" \
INTERNAL_SERVICE_STUN_SERVERS="stun.cloudflare.com:3478,stun1.l.google.com:19302,stun4.l.google.com:19302" \
  "$BIN" --bind "127.0.0.1:$PORT" >"$WORK/agent.log" 2>&1 &
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

    # shellcheck source=scripts/lib/smoke-signature.sh
    . "$LIB/smoke-signature.sh"
    # shellcheck source=scripts/lib/smoke-certificate.sh
    . "$LIB/smoke-certificate.sh"
    # shellcheck source=scripts/lib/smoke-handshake.sh
    . "$LIB/smoke-handshake.sh"
    # shellcheck source=scripts/lib/smoke-register.sh
    . "$LIB/smoke-register.sh"

    echo "== $ARCHIVE is runnable =="
    exit 0
  fi
  sleep 1
done

echo "::error::agent never listened on 127.0.0.1:$PORT within 60s" >&2
tail -20 "$WORK/agent.log" >&2
exit 1
