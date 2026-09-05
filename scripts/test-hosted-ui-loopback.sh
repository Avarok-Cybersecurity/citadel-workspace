#!/usr/bin/env bash
#
# The whole hosted-UI path, end to end, in one browser: a page served from a NON-loopback
# host (work.test, resolved to 127.0.0.1 by Chromium's host-resolver rules) must dial the
# agent on the visitor's machine at wss://local.test:PORT, where the agent terminates TLS
# with a certificate for that name and admits the page's Origin. Every layer is exercised
# by the browser itself: the meta the UI image renders, the CSP it serves, the resolver's
# choice, the agent's TLS, its Origin and Host checks.
#
# Pieces, all local:
#   - the UI image ($UI_IMAGE; built from docker/ui/Dockerfile --target production), with
#     LOOPBACK_AGENT_ORIGIN set -- the container is what a tenant runs;
#   - the agent binary ($AGENT_BIN; citadel-workspace-internal-service), with a throwaway
#     certificate for local.test -- the browser is told to accept it;
#   - the Playwright spec citadel-workspaces/integration-tests/src/tests-pw/hosted-ui-loopback.spec.ts.
#
# Controls, by environment: AGENT_ALLOWED_ORIGINS=http://other.test makes the agent refuse
# the page and the hosted test must fail; UI_LOOPBACK_ORIGIN= (empty) leaves the meta empty
# and the hosted test must fail because the page dials same-origin /ws instead.
#
# Usage: scripts/test-hosted-ui-loopback.sh   (from the repo root; needs docker, openssl, node)
set -euo pipefail
UI_IMAGE="${UI_IMAGE:-citadel-ui-loopback:test}"
# The agent: a local binary, or -- AGENT_IMAGE set -- the built docker image, run on the
# host network so the port the browser names is the port the agent bound (the Host
# allowlist is derived from the bound port; a published-port mapping would put them
# out of step and every handshake would be refused as a foreign Host). CI uses the image
# the workflow already built; a developer uses the binary.
AGENT_BIN="${AGENT_BIN:-target/debug/citadel-workspace-internal-service}"
AGENT_IMAGE="${AGENT_IMAGE:-}"
UI_PORT="${UI_PORT:-18082}"
AGENT_PORT="${AGENT_PORT:-12347}"
HOSTED_HOST="work.test"
LOOPBACK_HOST="local.test"
AGENT_ALLOWED_ORIGINS="${AGENT_ALLOWED_ORIGINS:-http://$HOSTED_HOST:$UI_PORT}"
UI_LOOPBACK_ORIGIN="${UI_LOOPBACK_ORIGIN-wss://$LOOPBACK_HOST:$AGENT_PORT}"
if [ -n "$AGENT_IMAGE" ]; then
  docker image inspect "$AGENT_IMAGE" >/dev/null 2>&1 || { echo "::error::no agent image $AGENT_IMAGE"; exit 1; }
else
  [ -x "$AGENT_BIN" ] || { echo "::error::no agent binary at $AGENT_BIN (cargo build -p citadel-workspace-internal-service), and AGENT_IMAGE is unset"; exit 1; }
fi
docker image inspect "$UI_IMAGE" >/dev/null 2>&1 || { echo "::error::no UI image $UI_IMAGE (docker build -f docker/ui/Dockerfile --target production -t $UI_IMAGE .)"; exit 1; }

WORK="$(mktemp -d)"; CTR="hosted-ui-loopback-$$"; AGENT_CTR="hosted-ui-loopback-agent-$$"; AGENT_PID=""
cleanup() { [ -n "$AGENT_PID" ] && kill "$AGENT_PID" 2>/dev/null || true; docker rm -f "$CTR" "$AGENT_CTR" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 1 \
  -keyout "$WORK/loopback.key" -out "$WORK/loopback.pem" -subj "/CN=$LOOPBACK_HOST" \
  -addext "subjectAltName=DNS:$LOOPBACK_HOST" >/dev/null 2>&1

if [ -n "$AGENT_IMAGE" ]; then
  chmod 0644 "$WORK/loopback.key"   # the container runs as its own user; the key is public by construction anyway
  docker run -d --name "$AGENT_CTR" --network host -v "$WORK:/certs:ro" \
    -e "INTERNAL_SERVICE_ALLOWED_ORIGINS=$AGENT_ALLOWED_ORIGINS" "$AGENT_IMAGE" \
    /usr/local/bin/citadel-workspace-internal-service --bind "127.0.0.1:$AGENT_PORT" \
    --loopback-host "$LOOPBACK_HOST" --tls-cert /certs/loopback.pem --tls-key /certs/loopback.key >/dev/null
else
  INTERNAL_SERVICE_ALLOWED_ORIGINS="$AGENT_ALLOWED_ORIGINS" SKIP_WASM_BUILD=1 \
    "$AGENT_BIN" --bind "127.0.0.1:$AGENT_PORT" --loopback-host "$LOOPBACK_HOST" \
    --tls-cert "$WORK/loopback.pem" --tls-key "$WORK/loopback.key" >"$WORK/agent.log" 2>&1 &
  AGENT_PID=$!
fi

docker run -d --name "$CTR" -p "127.0.0.1:$UI_PORT:8080" \
  -e WS_PROXY_ENABLED=0 -e AGENT_UPSTREAM=127.0.0.1:1 -e LISTEN_ADDR=0.0.0.0 \
  -e "LOOPBACK_AGENT_ORIGIN=$UI_LOOPBACK_ORIGIN" "$UI_IMAGE" >/dev/null

for _ in $(seq 1 30); do
  if [ -n "$AGENT_PID" ]; then
    kill -0 "$AGENT_PID" 2>/dev/null || { echo "::error::the agent exited:"; tail -5 "$WORK/agent.log"; exit 1; }
  else
    [ "$(docker inspect -f '{{.State.Running}}' "$AGENT_CTR" 2>/dev/null)" = "true" ] || { echo "::error::the agent container exited:"; docker logs "$AGENT_CTR" 2>&1 | tail -5; exit 1; }
  fi
  ui=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$UI_PORT/" || true)
  agent=$(python3 -c "import socket,sys;s=socket.socket();s.settimeout(0.4);sys.exit(0 if s.connect_ex(('127.0.0.1',$AGENT_PORT))==0 else 1)" && echo up || echo down)
  [ "$ui" = "200" ] && [ "$agent" = "up" ] && break
  sleep 1
done
[ "$ui" = "200" ] || { echo "::error::the UI container never served / (got ${ui:-nothing})"; docker logs "$CTR" 2>&1 | tail -5; exit 1; }
[ "$agent" = "up" ] || { echo "::error::the agent never listened on $AGENT_PORT"; [ -n "$AGENT_PID" ] && tail -5 "$WORK/agent.log" || docker logs "$AGENT_CTR" 2>&1 | tail -5; exit 1; }
echo "  UI at http://$HOSTED_HOST:$UI_PORT (container), agent at wss://$LOOPBACK_HOST:$AGENT_PORT (TLS), origin published: '${UI_LOOPBACK_ORIGIN}'"

cd citadel-workspaces/integration-tests
HOSTED_UI_URL="http://$HOSTED_HOST:$UI_PORT" LOCAL_UI_URL="http://127.0.0.1:$UI_PORT" \
LOOPBACK_AGENT_URL="wss://$LOOPBACK_HOST:$AGENT_PORT/" \
  npx playwright test src/tests-pw/hosted-ui-loopback.spec.ts --reporter=list
