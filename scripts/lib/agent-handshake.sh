#!/usr/bin/env bash
# Opens a WebSocket handshake to an agent on loopback, as a browser on <origin> would, and prints
# the HTTP status: 101 when the agent accepts the origin, 403 when its allowlist refuses it.
#
#   scripts/lib/agent-handshake.sh <port> <origin>
#
# Over TLS to local.avarok.net with the certificate verified (no --insecure): that name, and its
# compiled-in certificate, are what a hosted page dials. --resolve pins it to 127.0.0.1, so the
# check does not depend on the runner's resolver.
set -euo pipefail
PORT="${1:?usage: agent-handshake.sh <port> <origin>}"; ORIGIN="${2:?usage: agent-handshake.sh <port> <origin>}"
curl -s -o /dev/null -w '%{http_code}' --max-time 5 --resolve "local.avarok.net:$PORT:127.0.0.1" \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' -H "Origin: $ORIGIN" "https://local.avarok.net:$PORT/" || true
