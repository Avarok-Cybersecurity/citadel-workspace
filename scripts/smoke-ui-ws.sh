#!/usr/bin/env bash
#
# Smoke-test the UI image's /ws agent proxy and its security controls.
#
# WHY THIS IS A SCRIPT AND NOT INLINE YAML
#
# These assertions guard an UNAUTHENTICATED control plane: whatever reaches the agent's
# WebSocket can drive a user's sessions. They therefore have to run on the pull request
# that could break them, not only on the publish pipeline that runs after the merge
# decision has already been made. Living in one file means validate.yml (PR gate) and
# publish-images.yml (release gate) assert exactly the same things, and neither can
# quietly drift into testing less than the other.
#
# This is not hypothetical. The switch below was once written `if ($flag = "0")`, which
# fails OPEN for every value except the literal "0" - so `WS_PROXY_ENABLED=false` exposed
# the agent while reading as if it disabled it. Nothing in the PR gate would have caught
# that.
#
# Usage:  scripts/smoke-ui-ws.sh <image-ref> [host-port]
#
# Requires: docker, curl. Exits non-zero on the first failed assertion.

set -euo pipefail

IMAGE="${1:?usage: smoke-ui-ws.sh <image-ref> [host-port]}"
PORT="${2:-18080}"
BASE="http://127.0.0.1:${PORT}"
CTR="smoke-ui-ws-$$"

cleanup() { docker rm -f "$CTR" >/dev/null 2>&1 || true; }
trap cleanup EXIT

fail() { echo "::error::$*"; exit 1; }

# Start the image with a given WS_PROXY_ENABLED value ("__unset__" passes no env at all),
# published on LOOPBACK - /ws requires a loopback Host, exactly as a real browser provides.
#
# `docker run` is RETRIED rather than the port being probed first. This script cycles seven
# containers over the same published port, and `docker rm -f` returns once the container is gone
# while the daemon's port binding can briefly outlive it - so a naive run can lose the race with
# "port is already allocated". Probing the port to predict that is the wrong shape: every probe is
# itself a TCP connection to whatever still holds the socket, and a probe that succeeds tells you
# nothing about whether the NEXT bind will. Retrying the actual operation tests the actual
# precondition, and costs nothing when it succeeds first time (the common case).
#
# It matters because this is a SECURITY gate: one that fails at random trains people to re-run
# until green, and the next real regression gets waved through the same way.
start() {
  local val="$1"
  cleanup
  local args=(-d --name "$CTR" -p "127.0.0.1:${PORT}:8080")
  [ "$val" = "__unset__" ] || args+=(-e "WS_PROXY_ENABLED=$val")
  local attempt run_err
  for attempt in 1 2 3 4 5; do
    if run_err=$(docker run "${args[@]}" "$IMAGE" 2>&1 >/dev/null); then
      break
    fi
    if [ "$attempt" -eq 5 ]; then
      fail "could not start the smoke container after 5 attempts: $run_err"
    fi
    # Almost always the previous container's port binding has not been released yet.
    docker rm -f "$CTR" >/dev/null 2>&1 || true
    sleep 1
  done
  local i
  for ((i = 1; i <= 30; i++)); do
    curl -sf -o /dev/null "$BASE/" 2>/dev/null && return 0
    sleep 1
  done
  # A container that never started would make every assertion below trivially "pass" as a
  # connection error, so treat not-ready as a hard failure and show why.
  docker logs "$CTR" 2>&1 | tail -30
  fail "the UI container never became ready; the assertions would be meaningless."
}

# Status code for a request, with optional Host and Origin overrides.
code() { # <path> [origin] [host]
  local path="$1" origin="${2:-}" host="${3:-}"
  local args=(-s -o /dev/null -w '%{http_code}')
  [ -n "$origin" ] && args+=(-H "Origin: $origin")
  [ -n "$host" ] && args+=(-H "Host: $host")
  curl "${args[@]}" "$BASE$path"
}

echo "== UI /ws smoke test: $IMAGE =="

# ---------------------------------------------------------------------------
# 1. The proxy ENABLED. Everything below is the deployed local-client posture.
# ---------------------------------------------------------------------------
start 1

curl -sf "$BASE/" | grep -q '<div id="root"' \
  || fail "the UI did not serve the SPA shell. nginx binds even when it serves nothing, so this is the real liveness check."

# The render must contain the proxy and keep nginx's own variables. This catches a
# grossly broken template or a bad substitution; it does NOT by itself prove the envsubst
# filter is in place (see the collision check further down, which does).
docker exec "$CTR" grep -q 'location = /ws' /etc/nginx/conf.d/default.conf \
  || { docker exec "$CTR" cat /etc/nginx/conf.d/default.conf; fail "'location = /ws' is missing from the rendered config."; }
docker exec "$CTR" grep -q 'proxy_set_header Upgrade \$http_upgrade' /etc/nginx/conf.d/default.conf \
  || { docker exec "$CTR" cat /etc/nginx/conf.d/default.conf; fail "the rendered config lost \$http_upgrade - the websocket upgrade would be silently dropped."; }

# Same-origin. A page on another origin must not drive the agent through the user's browser
# (cross-site WebSocket hijacking), and neither must a client that sends no Origin at all.
[ "$(code /ws 'http://evil.example')" = "403" ] \
  || fail "/ws accepted a CROSS-ORIGIN request; expected 403. This is a cross-site WebSocket hijacking hole."
[ "$(code /ws)" = "403" ] \
  || fail "/ws accepted a request with NO Origin; expected 403."

# DNS rebinding: Host and Origin MATCH each other, so the same-origin check alone says yes.
# Only the loopback Host allowlist catches this.
[ "$(code /ws 'http://evil.example:8080' 'evil.example:8080')" = "403" ] \
  || fail "/ws accepted a DNS-REBINDING handshake (Host=Origin=evil.example); expected 403."

# The allowlist contains an IP literal (0.0.0.0), so prove it did not become "any IP".
[ "$(code /ws 'http://192.168.1.50:8080' '192.168.1.50:8080')" = "403" ] \
  || fail "/ws accepted a LAN Host; expected 403. Serving /ws to the local network hands the agent to every machine on it."

# BOTH checks failing at once. nginx evaluates the `if` blocks in this location sequentially and
# `return` inside one terminates immediately - but that is implicit rewrite-module behaviour, and
# "if is evil" precisely because its interactions are easy to get wrong. Pin it: a request that
# fails the Host allowlist AND the Origin check must be refused, not fall through to proxy_pass.
# A 502 here would mean it reached the agent despite failing two independent gates.
[ "$(code /ws 'http://other.example' 'evil.example:8080')" = "403" ] \
  || fail "/ws returned $(code /ws 'http://other.example' 'evil.example:8080') for a request failing BOTH the Host and Origin checks; expected 403. Anything else means the if-chain let it through to the agent."

# ...and it must still ACCEPT its own origin, or the gate is uselessly strict and the app can
# never connect. No agent runs here, so 502 is the proof the request passed every gate and
# nginx went looking for the upstream.
[ "$(code /ws "$BASE")" = "502" ] \
  || fail "/ws refused a SAME-ORIGIN request (got $(code /ws "$BASE"), expected 502 = gates passed, no agent present). A 403 here means the app could never connect."

# Exact-match location: a prefix match would forward /wsfoo to the agent too.
[ "$(code /wsfoo "$BASE")" = "200" ] \
  || fail "/wsfoo was not served by the SPA - the /ws location is matching as a prefix."

# Error pages must still carry the CSP. This holds only because the /ws block declares no
# add_header of its own and so inherits the server-level set; adding one there silently
# replaces them all.
curl -s -D - -o /dev/null -H "Origin: http://evil.example" "$BASE/ws" | grep -qi '^content-security-policy' \
  || fail "/ws error responses lost the Content-Security-Policy header."

# Media capture must be PERMITTED for this origin.
#
# `microphone=()` is an EMPTY allowlist: it denies every origin including this
# one, so getUserMedia fails and audio/video calling is dead. The header shipped
# that way, written before the app had calling, and nothing noticed because the
# dev server sends no Permissions-Policy at all — every test passed against a
# policy production does not use.
#
# Asserted here rather than trusted, because the failure is silent: the app
# loads, the call UI opens, and only the camera never starts.
# The service worker must NOT be cacheable.
#
# This is the upgrade path: a browser that keeps serving an old sw.js never
# learns a new version exists, so the app silently stops updating for everyone
# who already installed it. nginx applies heuristic caching without an explicit
# policy, and the failure produces no error anywhere — the deploy succeeds and
# users simply stay on yesterday's build.
SWHDR="$(curl -s -D - -o /dev/null "$BASE/sw.js" || true)"
echo "$SWHDR" | grep -qi '^cache-control:.*no-store' \
  || fail "sw.js is cacheable - installed apps will never see an update. Got: $(echo "$SWHDR" | grep -i '^cache-control' || echo 'no Cache-Control at all')"

# And the manifest needs its own media type, or Chrome refuses it and the app
# stops being installable.
MANHDR="$(curl -s -D - -o /dev/null "$BASE/manifest.webmanifest" || true)"
echo "$MANHDR" | grep -qi '^content-type:.*application/manifest+json' \
  || fail "manifest.webmanifest is not served as application/manifest+json - Chrome will reject it and the app stops being installable. Got: $(echo "$MANHDR" | grep -i '^content-type' || echo 'no Content-Type')"

PERMPOL="$(curl -s -D - -o /dev/null "$BASE/" | grep -i '^permissions-policy' || true)"
[ -n "$PERMPOL" ] \
  || fail "The SPA response carries no Permissions-Policy header at all."
echo "$PERMPOL" | grep -qi 'microphone=(self)' \
  || fail "Permissions-Policy does not allow microphone for this origin - calling will not work. Got: $PERMPOL"
echo "$PERMPOL" | grep -qi 'camera=(self)' \
  || fail "Permissions-Policy does not allow camera for this origin - video calling will not work. Got: $PERMPOL"
echo "$PERMPOL" | grep -qi 'display-capture=(self)' \
  || fail "Permissions-Policy does not allow display-capture - screen sharing will not work. Got: $PERMPOL"

echo "  enabled: SPA served; envsubst intact; same-origin enforced (403 cross-origin, 403 no-Origin, 403 rebinding, 403 LAN, 403 both-fail); same-origin proxied; no prefix match; CSP preserved; media capture permitted; sw.js uncacheable; manifest typed."

# ---------------------------------------------------------------------------
# 2. The switch is OPT-IN. Only the literal "1" may enable the proxy.
# ---------------------------------------------------------------------------
# Tested with the values an operator would plausibly reach for to turn it OFF. The obvious
# spelling of the guard (`= "0"`) fails OPEN for every one of these.
# Includes TRUTHY-looking values (on/yes/true). They must still DISABLE the proxy: the switch is
# an explicit opt-in on the literal "1", so anything else fails closed. Pinning the truthy ones
# matters more than the falsy ones - someone writing `true` expects it enabled, and this asserts
# they instead get a safe 404 rather than a silently exposed agent.
for val in "__unset__" "" "0" "false" "off" "no" "on" "yes" "true"; do
  start "$val"
  got="$(code /ws "$BASE")"
  [ "$got" = "404" ] \
    || fail "WS_PROXY_ENABLED='${val/__unset__/<unset>}' left /ws ENABLED (got $got, want 404). The switch must be opt-in: anything but the literal 1 has to disable the proxy, or an operator turning it 'off' would expose the agent."
  [ "$(code /)" = "200" ] \
    || fail "with the proxy disabled the SPA stopped serving; disabling /ws must not break the app."
done

echo "  opt-in: only the literal WS_PROXY_ENABLED=1 enables the proxy; unset, '', 0, false, off, no, on, yes and true all disable it while still serving the SPA."

# ---------------------------------------------------------------------------
# 3. envsubst is pinned to our three variables (NGINX_ENVSUBST_FILTER).
# ---------------------------------------------------------------------------
# Unfiltered, envsubst is eligible to replace EVERY environment variable - so an env var
# whose name collides with an nginx variable rewrites the config. Start the image with a
# colliding `host` and assert `$host` survives. Without the filter this renders
# `proxy_set_header Host pwned;`, which is config injection by whoever can set env vars.
cleanup
docker run -d --name "$CTR" -e WS_PROXY_ENABLED=1 -e host=pwned -e http_upgrade=pwned \
  -p "127.0.0.1:${PORT}:8080" "$IMAGE" >/dev/null
for ((i = 1; i <= 30; i++)); do curl -sf -o /dev/null "$BASE/" 2>/dev/null && break; sleep 1; done
rendered=$(docker exec "$CTR" cat /etc/nginx/conf.d/default.conf)
echo "$rendered" | grep -q 'proxy_set_header Host \$host' \
  || fail "an environment variable named 'host' rewrote \$host in the rendered config - NGINX_ENVSUBST_FILTER is not pinning substitution, so env vars can inject into the proxy config."
echo "$rendered" | grep -q 'proxy_set_header Upgrade \$http_upgrade' \
  || fail "an environment variable named 'http_upgrade' rewrote \$http_upgrade in the rendered config - NGINX_ENVSUBST_FILTER is not pinning substitution."
echo "  envsubst: pinned - colliding env vars (host, http_upgrade) cannot rewrite nginx's own variables."

# ---------------------------------------------------------------------------
# 4. Runtime variables cannot inject nginx configuration.
# ---------------------------------------------------------------------------
# These values are substituted into the config VERBATIM, so a `;` closes the directive and
# everything after it becomes real configuration. Before validation was added, AGENT_UPSTREAM=
# '127.0.0.1:12345/; return 200 "X"; #' rendered a working config and nginx STARTED on it. The
# entrypoint validator must now refuse to start instead.
for bad_var in "AGENT_UPSTREAM=127.0.0.1:12345/; return 200 \"X\"; #" \
               "WS_PROXY_ENABLED=1\"; return 200 \"X\"; #" \
               "LISTEN_ADDR=0.0.0.0; return 200 \"X\"; #"; do
  vc="smoke-ui-inject"
  docker rm -f "$vc" >/dev/null 2>&1 || true
  docker run -d --name "$vc" -e WS_PROXY_ENABLED=1 -e AGENT_UPSTREAM=127.0.0.1:12345 \
    -e "$bad_var" "$IMAGE" >/dev/null 2>&1 || true
  sleep 3
  state=$(docker inspect -f '{{.State.Status}}' "$vc" 2>/dev/null || echo missing)
  logs=$(docker logs "$vc" 2>&1 | grep -c "validate-runtime-vars.*FATAL" || true)
  docker rm -f "$vc" >/dev/null 2>&1 || true
  if [ "$state" = "running" ] || [ "$logs" = "0" ]; then
    fail "the image STARTED with an injecting runtime variable (${bad_var%%=*}), or did not report why it refused. That value is substituted straight into the nginx config, so it can add arbitrary directives."
  fi
done
echo "  injection: runtime variables containing nginx metacharacters are rejected at startup."

echo "== all /ws smoke assertions passed =="
