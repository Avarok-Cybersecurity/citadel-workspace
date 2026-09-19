#!/usr/bin/env bash
# deploy-ui.sh must refuse bad input BEFORE it touches Docker: its next act is
# `docker rm -f` on the running UI, so a refusal after that point is an outage.
#
# `docker` here is a stand-in that records being reached and fails, so no
# container is ever touched. Refusals must never reach it; valid input must.
set -uo pipefail
cd "$(dirname "$0")/.."

fake=$(mktemp -d); trap 'rm -rf "$fake"' EXIT
printf '#!/bin/sh\necho REACHED-DOCKER\nexit 1\n' > "$fake/docker"; chmod +x "$fake/docker"
fails=0
ORIGIN=wss://local.avarok.net:12345

run() { env PATH="$fake:$PATH" "$@" bash scripts/deploy-ui.sh sha-0123456789ab 2>&1; }
refuses() {
  local what=$1; shift
  local out; out=$(run "$@")
  if grep -q REACHED-DOCKER <<<"$out"; then echo "  FAIL: $what reached docker"; fails=$((fails+1))
  else echo "  ok: refused $what before docker"; fi
}

refuses "no UI_PORT"                 env -u UI_PORT LOOPBACK_AGENT_ORIGIN=$ORIGIN
refuses "a non-numeric UI_PORT"      env UI_PORT=eighty LOOPBACK_AGENT_ORIGIN=$ORIGIN
refuses "UI_PORT 0"                  env UI_PORT=0 LOOPBACK_AGENT_ORIGIN=$ORIGIN
refuses "UI_PORT above 65535"        env UI_PORT=70000 LOOPBACK_AGENT_ORIGIN=$ORIGIN
refuses "no LOOPBACK_AGENT_ORIGIN"   env UI_PORT=12402 -u LOOPBACK_AGENT_ORIGIN
refuses "an origin with no port"     env UI_PORT=12402 LOOPBACK_AGENT_ORIGIN=wss://local.avarok.net
out=$(env PATH="$fake:$PATH" UI_PORT=12402 LOOPBACK_AGENT_ORIGIN=$ORIGIN bash scripts/deploy-ui.sh 2>&1)
if grep -q REACHED-DOCKER <<<"$out"; then echo "  FAIL: no tag reached docker"; fails=$((fails+1)); else echo "  ok: refused no tag before docker"; fi

out=$(run env UI_PORT=12402 LOOPBACK_AGENT_ORIGIN=$ORIGIN)
if grep -q REACHED-DOCKER <<<"$out"; then echo "  ok: valid input gets as far as docker"
else echo "  FAIL: valid input was refused: $(tail -1 <<<"$out")"; fails=$((fails+1)); fi

if [ "$fails" -ne 0 ]; then echo "FAIL: $fails assertion(s)"; exit 1; fi
echo "deploy-ui: every bad input refused before docker, valid input accepted."
