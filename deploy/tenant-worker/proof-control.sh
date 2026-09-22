#!/usr/bin/env bash
# Runs the Phase 4a proof end to end under `wrangler dev` on :8817 (nothing is deployed):
#   1. free tenant + wasm client, 2. real Stripe TEST-mode Checkout + signed webhooks,
#   3. negative control: the always-fail Turnstile secret.
# Reads the Stripe restricted key from ~/stripe.citadel.test.rk.txt into .dev.vars (gitignored);
# prints no secret. The webhook secret is generated per run: no Stripe endpoint is involved.
set -euo pipefail
cd "$(dirname "$0")"
PORT=8817
BASE="http://127.0.0.1:$PORT"
PERSIST=.wrangler-proof
KEYFILE="${STRIPE_KEY_FILE:-$HOME/stripe.citadel.test.rk.txt}"

key=$(grep '^STRIPE_SECRET_KEY=' "$KEYFILE" | cut -d= -f2-)
case "$key" in rk_test_*|sk_test_*) ;; *) echo "refusing: $KEYFILE does not hold a TEST-mode key"; exit 1 ;; esac

write_vars() {  # $1 = Turnstile secret (Cloudflare's public testing secrets only)
  umask 077
  {
    echo "TURNSTILE_SECRET=$1"
    echo "STRIPE_SECRET_KEY=$key"
    echo "STRIPE_WEBHOOK_SECRET=$WHSEC"
  } > .dev.vars
}

serve() {
  npx wrangler dev --port "$PORT" --ip 127.0.0.1 --persist-to "$PERSIST" \
    --var TENANT_PATH_ROUTING:on --var TURNSTILE_HOSTNAMES:example.com --var "ALLOWED_ORIGINS:$BASE" \
    > "$PERSIST.log" 2>&1 &
  PID=$!
  for _ in $(seq 1 60); do
    curl -sf "$BASE/api/slug/probe-ready" > /dev/null && return 0
    sleep 1
  done
  echo "wrangler dev did not come up; see $PERSIST.log"; exit 1
}
stop() { kill "$PID" 2>/dev/null || true; wait "$PID" 2>/dev/null || true; }
trap stop EXIT

WHSEC="whsec_$(openssl rand -hex 24)"
rm -rf "$PERSIST"
npx wrangler d1 migrations apply citadel-control --local --persist-to "$PERSIST" > "$PERSIST.migrate.log" 2>&1

echo "== always-pass Turnstile testing secret"
write_vars 1x0000000000000000000000000000000AA
serve
node proof-control.mjs free "$BASE"
node proof-control.mjs paid "$BASE"
stop

echo "== always-fail Turnstile testing secret (negative control)"
write_vars 2x0000000000000000000000000000000AA
serve
node proof-control.mjs denied "$BASE"
rows=$(npx wrangler d1 execute citadel-control --local --persist-to "$PERSIST" --json \
  --command "SELECT COUNT(*) AS n FROM tenants WHERE slug LIKE 'denied-%'" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s)[0].results[0].n))')
echo "tenant rows for denied-* in D1: $rows"
[ "$rows" = "0" ] || { echo "PROOF FAIL: a refused creation wrote a row"; exit 1; }
rm -f .dev.vars
