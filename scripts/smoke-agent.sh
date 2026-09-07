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

# The allowlist is REQUIRED by the WebSocket agent (it refuses to start without one); the
# handshake below presents this origin, and a foreign one, to prove the policy shipped.
INTERNAL_SERVICE_ALLOWED_ORIGINS="http://localhost:5291" \
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

    # A macOS binary must be Developer-ID signed with the hardened runtime.
    #
    # Rust's linker produces an ad-hoc signature, which `spctl -a -t exec`
    # rejects: a Finder double-click gets "the developer cannot be verified".
    # Terminal execution of a quarantined ad-hoc binary still works today, which
    # is why this went unnoticed -- Apple's tolerance, not a guarantee.
    #
    # Checked HERE because this script already runs against the real release
    # artefact, so an unsigned binary cannot be published even if the signing
    # step is later moved, disabled, or silently skipped for want of a secret.
    #
    # Only on macOS, and only for a Mach-O: codesign does not exist elsewhere,
    # and the Linux and Windows assets are not Apple's to assess.
    if [ "$(uname -s)" = "Darwin" ] && printf '%s' "$DESC" | grep -q "Mach-O"; then
      if ! codesign --verify --strict "$BIN" 2>/dev/null; then
        echo "::error::$ARCHIVE contains a binary whose signature does not verify." >&2
        exit 1
      fi
      AUTHORITY="$(codesign -dv --verbose=4 "$BIN" 2>&1 | awk -F= '/^Authority=/ {print $2; exit}')"
      case "$AUTHORITY" in
        "Developer ID Application"*) echo "  signed by: $AUTHORITY" ;;
        *)
          echo "::error::$ARCHIVE is not signed with a Developer ID Application certificate." >&2
          echo "  Authority: ${AUTHORITY:-<none: ad-hoc or unsigned>}" >&2
          echo "  Gatekeeper refuses this on a machine that downloaded it through a browser." >&2
          exit 1 ;;
      esac
      # Hardened runtime, without which notarisation is refused outright.
      if ! codesign -dv --verbose=4 "$BIN" 2>&1 | grep -q "flags=.*runtime"; then
        echo "::error::$ARCHIVE is signed WITHOUT the hardened runtime (--options runtime)." >&2
        echo "  Apple rejects notarisation for this, so the binary would ship signed and" >&2
        echo "  still be refused." >&2
        exit 1
      fi
      echo "  hardened runtime: on"
    fi

    # The built-in certificate must not be near expiry.
    #
    # This binary SERVES TLS for the loopback name a hosted page dials, using a
    # certificate compiled into it. When that certificate expires, every copy of
    # this release stops working at the same moment: the browser refuses the
    # socket, the page cannot reach the user's own agent, and there is NO
    # server-side remedy -- every user must download a new binary. A release cut
    # a week before expiry is a release that breaks a week later.
    #
    # 30 days is a floor, not a target. Let's Encrypt issues for 90, so a build
    # from a fresh certificate starts near 89; this fires only when one has been
    # left unrenewed for two months.
    MIN_CERT_DAYS="${MIN_CERT_DAYS:-30}"
    CERT_END="$(echo | openssl s_client -connect "127.0.0.1:$PORT" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2 || true)"
    if [ -n "$CERT_END" ]; then
      DAYS="$(CERT_END="$CERT_END" python3 -c '
import os, datetime
end = datetime.datetime.strptime(os.environ["CERT_END"].strip(), "%b %d %H:%M:%S %Y %Z")
end = end.replace(tzinfo=datetime.timezone.utc)
print((end - datetime.datetime.now(datetime.timezone.utc)).days)
')"
      if [ "$DAYS" -lt "$MIN_CERT_DAYS" ]; then
        echo "::error::the built-in certificate expires in ${DAYS} days (< ${MIN_CERT_DAYS})." >&2
        echo "  Every user of this release loses TLS at that moment and needs a new binary." >&2
        echo "  Renew the certificate and rebuild before publishing." >&2
        exit 1
      fi
      echo "  built-in certificate valid for ${DAYS} more days"
    else
      # Not fatal: a --no-tls or plaintext build legitimately serves none. Said
      # out loud, because silence would hide the check never running at all.
      echo "  (no TLS certificate served on this port -- expiry not checked)"
    fi
    # Listening is not speaking. agent-v0.1.0 listened, and was the raw-TCP kernel binary:
    # a browser's WebSocket handshake got the connection closed. So: a real handshake, with
    # the allowed Origin, must be answered 101 -- and one with a foreign Origin must be
    # refused 403, which proves the allowlist is in the shipped binary and not only in the
    # docker image.
    # Over TLS, to `local.avarok.net`, with NO --insecure.
    #
    # The agent serves wss:// by default and presents a certificate for
    # local.avarok.net that is compiled into it. That name is public and its A
    # record is 127.0.0.1, so this reaches the agent just started here and the
    # certificate validates against the system trust store like any other.
    #
    # Verifying it properly is the point: agent-v0.1.0 shipped a plain-WebSocket
    # binary, and work.avarok.net -- an HTTPS page, which a browser forbids from
    # opening ws:// -- got ERR_SSL_PROTOCOL_ERROR from every visitor. `--insecure`
    # here would pass over an expired or wrong-name certificate and leave the same
    # failure to be discovered by users.
    handshake() { # <origin> -> first response line
      curl -s -i --max-time 5 -H "Connection: Upgrade" -H "Upgrade: websocket" \
        -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
        -H "Origin: $1" "https://local.avarok.net:$PORT/" 2>/dev/null | head -n1 | tr -d '\r' || true
      # `|| true`: a closed connection makes curl exit non-zero, and under pipefail + set -e
      # that killed this script before the assertion below could name the failure. The
      # empty result IS the finding; the case statement reports it.
    }
    got="$(handshake http://localhost:5291)"
    case "$got" in
      *" 101 "*) echo "  WebSocket handshake from the allowed origin: $got" ;;
      *) echo "::error::the agent does not speak WebSocket over TLS: handshake from the allowed origin got '${got:-<connection closed>}'. A hosted HTTPS page can only open wss://, so a browser cannot use this binary." >&2
         tail -20 "$WORK/agent.log" >&2; exit 1 ;;
    esac
    got="$(handshake http://evil.example)"
    case "$got" in
      *" 403 "*) echo "  handshake from a foreign origin refused: $got" ;;
      *) echo "::error::the agent accepted (or did not refuse with 403) a handshake from a foreign origin: '${got:-<connection closed>}'. The Origin allowlist is not in this binary." >&2; exit 1 ;;
    esac
    # Speaking WebSocket is not speaking the PROTOCOL.
    #
    # agent-v0.2.0 passes every assertion above -- it runs, it listens, it
    # completes a TLS handshake from the allowed origin and refuses a foreign
    # one -- and is still unusable for anyone who types a hostname as their
    # server address. Its `server_addr` was a `SocketAddr`, the UI sends
    # `citadel.avarok.net:12400`, and the agent rejected the first Register
    # before processing it:
    #
    #   Failed to deserialize WebSocket JSON message: invalid socket address syntax
    #
    # Nothing visible says so. The browser shows "Registration timed out" after
    # thirty seconds, the UI names no cause, and `debugLog` is a no-op in a
    # production bundle -- the agent's own log is the only place the truth
    # appears, and a user does not have it. Only a raw IP worked.
    #
    # So: send the request the UI actually sends, and require the agent to
    # UNDERSTAND it. Not to succeed -- registering against a server that is not
    # there legitimately fails many ways -- only to parse it.
    envelope() { # <server_addr JSON value> <username>
      printf '{"Request":{"Register":{"request_id":"00000000-0000-4000-8000-00000000000%s",' "$3"
      printf '"server_addr":%s,"full_name":"Smoke Probe","username":"%s",' "$1" "$2"
      printf '"proposed_password":[112,114,111,98,101],"connect_after_register":false,'
      printf '"session_security_settings":{"security_level":"Standard","secrecy_mode":"BestEffort",'
      printf '"crypto_params":{"encryption_algorithm":"AES_GCM_256","kem_algorithm":"MlKem","sig_algorithm":"None"},'
      printf '"header_obfuscator_settings":"Disabled"},"server_password":null}}}'
    }
    deserialize_failures() { grep -c "Failed to deserialize" "$WORK/agent.log" 2>/dev/null || echo 0; }

    before="$(deserialize_failures)"
    python3 scripts/lib/ws-send.py local.avarok.net "$PORT" http://localhost:5291 \
      "$(envelope '"citadel.example.net:12400"' smoke_hostname 1)" >/dev/null || {
        echo "::error::could not send a Register frame to the packaged agent" >&2
        tail -20 "$WORK/agent.log" >&2; exit 1; }
    sleep 2
    after="$(deserialize_failures)"
    if [ "$after" != "$before" ]; then
      echo "::error::the agent could not parse a Register carrying a HOSTNAME server address." >&2
      echo "::error::That is the request every user makes. Only a raw IP would work with this build." >&2
      grep "Failed to deserialize" "$WORK/agent.log" | tail -3 >&2
      exit 1
    fi
    echo "  a Register with a hostname server address is understood"

    # The positive control, in the check itself. Everything above is an
    # assertion that a counter did NOT move, and a counter that can never move
    # proves nothing: if the frame never arrived, if the log were elsewhere, if
    # the grep were wrong, the assertion would pass on an agent that
    # understands nothing at all. So send one the agent MUST reject, and require
    # the counter to move.
    before="$(deserialize_failures)"
    python3 scripts/lib/ws-send.py local.avarok.net "$PORT" http://localhost:5291 \
      "$(envelope 12400 smoke_control 2)" >/dev/null || true
    sleep 2
    after="$(deserialize_failures)"
    if [ "$after" = "$before" ]; then
      echo "::error::the control frame -- a Register whose server_addr is a NUMBER -- was not rejected." >&2
      echo "::error::So the check above proves nothing: either the frame is not reaching this agent," >&2
      echo "::error::or its parse failures do not reach $WORK/agent.log." >&2
      exit 1
    fi
    echo "  and a malformed one is rejected, so the check above can fail"

    echo "== $ARCHIVE is runnable =="
    exit 0
  fi
  sleep 1
done

echo "::error::agent never listened on 127.0.0.1:$PORT within 60s" >&2
tail -20 "$WORK/agent.log" >&2
exit 1
