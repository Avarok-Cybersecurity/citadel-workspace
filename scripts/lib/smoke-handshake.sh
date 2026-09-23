# shellcheck shell=bash
# Sourced by scripts/smoke-agent.sh once the agent listens on PORT: a WebSocket handshake
# over TLS, accepted from the allowed origin and refused from a foreign one.
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
