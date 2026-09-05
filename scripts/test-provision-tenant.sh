#!/usr/bin/env bash
# Every guard in provision-tenant.sh must actually refuse.
#
# A provisioning script that accepts bad input does not fail loudly -- it
# creates a tenant that is subtly wrong: a directory outside its root, a port
# already serving something else, an agent exposed where the design says it
# must not be. So each refusal is asserted here, and so is the acceptance of
# valid input, because a script that refuses everything would pass a
# refusal-only suite.
#
# The port check earned its test: `ss` is Linux-only, and the first version
# returned "free" for every port on a host without it. It reported safety it
# could not establish, which is the failure mode this file exists to catch.
set -uo pipefail
cd "$(dirname "$0")/.."
S=./scripts/provision-tenant.sh
fails=0

refuses() {
  local what="$1"; shift
  if "$@" >/dev/null 2>&1; then echo "  FAIL: $what was ACCEPTED"; fails=$((fails+1))
  else echo "  ok: refused $what"; fi
}
accepts() {
  local what="$1"; shift
  if "$@" >/dev/null 2>&1; then echo "  ok: accepted $what"
  else echo "  FAIL: $what was REFUSED"; fails=$((fails+1)); fi
}

refuses "missing --tenant"            $S --dry-run
refuses "path traversal in name"      $S --tenant ../etc --dry-run
refuses "uppercase/underscore name"   $S --tenant Bad_Name --dry-run
refuses "unknown ingress"             $S --tenant a --ingress ftp --dry-run
refuses "unknown topology"            $S --tenant a --topology weird --dry-run
refuses "ingress without domain"      $S --tenant a --topology full --ingress nginx --dry-run
refuses "ingress on server-only"      $S --tenant a --ingress nginx --domain x.io --dry-run
refuses "unknown flag"                $S --tenant a --nope --dry-run
refuses "no port tool available"      env PATH=/nonexistent bash $S --tenant a --dry-run

accepts "server-only, no ingress"     $S --tenant ok1 --dry-run
accepts "full + tunnel"               $S --tenant ok2 --topology full --ingress tunnel --domain w.example --dry-run
accepts "full + nginx"                $S --tenant ok3 --topology full --ingress nginx --domain w.example --dry-run

# An occupied port must be rejected. Bind one here rather than trusting that
# some well-known port happens to be busy on the runner -- a port that is free
# would make this assertion pass without testing anything.
PORTFILE=$(mktemp)
python3 -c "
import socket, sys, time
s = socket.socket(); s.bind(('127.0.0.1', 0)); s.listen(1)
open(sys.argv[1], 'w').write(str(s.getsockname()[1]))
time.sleep(10)
" "$PORTFILE" &
BINDER=$!
for _ in $(seq 1 20); do [ -s "$PORTFILE" ] && break; sleep 0.2; done
PORT=$(cat "$PORTFILE" 2>/dev/null || true)
if [ -n "$PORT" ]; then
  refuses "port already in use ($PORT)" $S --tenant a --base-port "$PORT" --dry-run
else
  echo "  FAIL: could not bind a port, so the occupied-port guard went untested"
  fails=$((fails+1))
fi
kill "$BINDER" 2>/dev/null || true
wait "$BINDER" 2>/dev/null || true   # suppress the shell's "Terminated" job notice
rm -f "$PORTFILE"

# The agent bind must be loopback in EVERY topology. Asserted on the rendered
# output, not on the source text: a comment saying 127.0.0.1 is not the same as
# an .env that carries it.
for topo in server-only full; do
  out=$($S --tenant a --topology "$topo" --dry-run 2>/dev/null || true)
  if echo "$out" | grep -q "^INTERNAL_SERVICE_BIND_HOST=127.0.0.1$"; then
    echo "  ok: agent binds loopback ($topo)"
  else
    echo "  FAIL: agent is not pinned to loopback in $topo"
    fails=$((fails+1))
  fi
done

refuses "domain with a scheme"        $S --tenant a --topology full --ingress nginx --domain https://w.example --dry-run
refuses "domain with a trailing slash" $S --tenant a --topology full --ingress nginx --domain w.example/ --dry-run
refuses "domain with a semicolon"     $S --tenant a --topology full --ingress nginx --domain "w.example;return 200" --dry-run
refuses "uppercase domain"            $S --tenant a --topology full --ingress nginx --domain W.example --dry-run

# A dry run is what an operator pastes where others can see it. The master password has always
# been redacted there; the tunnel token was printed in full.
out=$(TUNNEL_TOKEN=tunnel-token-not-a-placeholder $S --tenant ok9 --topology full --ingress tunnel --domain w.example --dry-run 2>/dev/null || true)
if echo "$out" | grep -q "tunnel-token-not-a-placeholder"; then
  echo "  FAIL: --dry-run printed the live TUNNEL_TOKEN"; fails=$((fails+1))
else
  echo "  ok: --dry-run redacts the tunnel token"
fi

# A --force re-provision must REPLACE the tenant's scripts, not nest a copy inside the old one.
# `cp -r src dst` copies INTO dst when dst exists, so the previous revision's gate scripts kept
# running while the fresh ones sat unused at scripts/scripts/.
FROOT="$(mktemp -d)"
$S --tenant reprov --topology server-only --base-port 21400 --root "$FROOT" >/dev/null 2>&1 || true
if [ -d "$FROOT/reprov/scripts" ]; then
  echo "STALE" > "$FROOT/reprov/scripts/verify-image-revisions.sh"
  $S --tenant reprov --topology server-only --base-port 21400 --root "$FROOT" --force >/dev/null 2>&1 || true
  if [ -d "$FROOT/reprov/scripts/scripts" ]; then
    echo "  FAIL: a --force re-provision nested scripts/scripts inside the tenant"; fails=$((fails+1))
  elif grep -q "^STALE$" "$FROOT/reprov/scripts/verify-image-revisions.sh" 2>/dev/null; then
    echo "  FAIL: a --force re-provision left the previous revision's verify-image-revisions.sh in place"; fails=$((fails+1))
  else
    echo "  ok: --force replaces the tenant's scripts rather than nesting a copy"
  fi
else
  echo "  FAIL: the first provision wrote no scripts directory"; fails=$((fails+1))
fi
rm -rf "$FROOT"

# The public vhost must carry HSTS: only the :80 redirect protects a first request otherwise.
if bash scripts/render-nginx-vhost.sh w.example 12402 t | grep -q "Strict-Transport-Security"; then
  echo "  ok: the TLS vhost sends HSTS"
else
  echo "  FAIL: the TLS vhost sends no Strict-Transport-Security"; fails=$((fails+1))
fi

if [ "$fails" -ne 0 ]; then echo "FAIL: $fails assertion(s)"; exit 1; fi
echo "provision-tenant: all guards refuse, all valid inputs accepted."
