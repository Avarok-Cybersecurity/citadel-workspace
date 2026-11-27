#!/usr/bin/env bash
# Deploys the tenant Worker (control plane, UI and tenant Durable Objects) to work.avarok.net and
# *.work.avarok.net. Run by the OPERATOR; DEPLOY.md is the runbook, including what must exist
# before the first run (the D1 database, DNS, the secrets, the Stripe webhook endpoint).
#
#   CITADEL_CF_TOKEN_FILE=~/cf-token.txt CITADEL_STRIPE_KEY_FILE=~/stripe.citadel.test.rk.txt ./deploy.sh
#   ./deploy.sh --dry-run     # build, gates and a bundle; no token, nothing sent to Cloudflare
#   ./deploy.sh --preflight   # with the token: every check that can refuse a deploy; changes nothing
#
# CITADEL_CF_TOKEN_FILE  a file holding the Cloudflare API token. Read here, handed to wrangler in
#                        its environment only; never an argument, never printed.
# CITADEL_FIRST_PARTY_SIGNED_DIR  the first-party apps every workspace is provisioned with, signed
#                        (`node scripts/build-first-party-apps.mjs --sign <dir>`, the deploy
#                        workflow's step with the signing secret); the server wasm embeds them.
# CITADEL_STRIPE_KEY_FILE a file holding STRIPE_SECRET_KEY=... for the read-only catalogue audit
#                        (scripts/stripe-catalogue.mjs): the prices the Worker sells must exist.
#                        A live key is refused by that script, so this deploys test mode only.
#
# Order: build (wasm, UI) -> local gates (vitest, stored-account compat, CSP parity) -> the D1 id
# is real -> Stripe's catalogue matches -> every secret is set -> no deleted Durable Object class
# keeps a live binding name -> wrangler's dry-run bundle -> the D1 migrations a deploy would apply
# [--preflight stops here, having changed nothing] -> D1 migrations (remote) -> deploy -> smoke.
#
# Everything before the stop can refuse the deploy, and none of it changes anything, so the deploy
# workflow runs it (--preflight) BEFORE the agent is released: a site upload Cloudflare refuses
# must not leave a new agent released beside the old site (deploy.yml; a static check holds the
# order, scripts/check-deploy-order.mjs).
set -euo pipefail
cd "$(dirname "$0")"
HERE="$(pwd)"
ROOT="$(cd ../.. && pwd)"
# Marks every build below as a deploy: the server kernel's build.rs refuses its test-only CI
# first-party root under it.
export CITADEL_DEPLOY=1

MODE=deploy
case "${1:-}" in
  "") ;;
  --dry-run) MODE=dry-run ;;
  --preflight) MODE=preflight ;;
  *) echo "usage: ./deploy.sh [--dry-run|--preflight]" >&2; exit 2 ;;
esac

REQUIRED_SECRETS=(TURNSTILE_SECRET STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET CITADEL_SUPPORT_MLDSA_PUBLIC_KEY CONTROL_SERVER_KEY_SEED)
# Optional until the agent asks for relay servers: TURN_KEY_ID and TURN_KEY_API_TOKEN. Unset,
# GetIceServers answers "no relay servers" (control/ice.mjs); DEPLOY.md step 4.
say() { printf '\n== %s\n' "$*"; }
fail() { echo "deploy: $*" >&2; exit 1; }

node -e 'const [maj] = process.versions.node.split("."); process.exit(Number(maj) >= 22 ? 0 : 1)' \
  || fail "Node >= 22 is required (node $(node --version))"

# The token: from the file the environment names, into this process only.
TOKEN=""
if [ "$MODE" != dry-run ]; then
  [ -n "${CITADEL_CF_TOKEN_FILE:-}" ] || fail "set CITADEL_CF_TOKEN_FILE to the file holding the Cloudflare API token"
  [ -f "$CITADEL_CF_TOKEN_FILE" ] || fail "CITADEL_CF_TOKEN_FILE names no file"
  # GNU first: on Linux `stat -f` means filesystem status and SUCCEEDS with other output, so a
  # BSD-first chain never reached its fallback and refused every CI deploy's 0600 file.
  # BSD/macOS rejects -c, so the chain falls through to its form there.
  case "$(stat -c '%a' "$CITADEL_CF_TOKEN_FILE" 2>/dev/null || stat -f '%Lp' "$CITADEL_CF_TOKEN_FILE")" in
    600|400) ;;
    *) fail "the token file is readable by others; chmod 600 it" ;;
  esac
  TOKEN="$(tr -d '\r\n ' < "$CITADEL_CF_TOKEN_FILE")"
  [ -n "$TOKEN" ] || fail "the token file is empty"
  [ -n "${CITADEL_STRIPE_KEY_FILE:-}" ] || fail "set CITADEL_STRIPE_KEY_FILE for the Stripe catalogue audit"
  # Without it the server builds with no first-party apps, and every new workspace lacks them.
  [ -n "${CITADEL_FIRST_PARTY_SIGNED_DIR:-}" ] || fail "set CITADEL_FIRST_PARTY_SIGNED_DIR to the signed first-party apps (build-first-party-apps.mjs --sign)"
  [ -f "$CITADEL_FIRST_PARTY_SIGNED_DIR/calendar/app.mldsa.sig" ] || fail "CITADEL_FIRST_PARTY_SIGNED_DIR holds no signed calendar"
  [ -f "$CITADEL_FIRST_PARTY_SIGNED_DIR/synchronized-work/app.mldsa.sig" ] || fail "CITADEL_FIRST_PARTY_SIGNED_DIR holds no signed synchronized-work"
  # An app-ABI app is listed only with the module the server stores for it (kernel build.rs).
  [ -s "$CITADEL_FIRST_PARTY_SIGNED_DIR/synchronized-work/module.wasm" ] || fail "CITADEL_FIRST_PARTY_SIGNED_DIR holds no synchronized-work module.wasm"
fi

# wrangler with the token in its environment, and any line that could echo an auth header dropped.
# awk, not `grep -v`: grep exits 1 when it prints nothing, which pipefail would read as a failure.
wr() {
  CLOUDFLARE_API_TOKEN="$TOKEN" CI=1 npx --no-install wrangler "$@" 2>&1 | awk '!/Bearer|Authorization/'
}

say "dependencies"
npm ci --no-audit --no-fund

say "build: the server wasm (build.sh)"
./build.sh
# The server that ships must not carry the CI first-party root's key, whatever built it.
"$ROOT/scripts/ci-first-party-key.sh" absent server-wasm/pkg/*.wasm
say "build: the UI (build-ui.sh)"
./build-ui.sh

say "gates"
npx --no-install vitest run
# The auth-record census reads the account records this SDK stores.
cargo test --locked -p tenant-storage-compat
node "$ROOT/scripts/check-preview-csp-matches-production.mjs"

# The configuration wrangler will deploy, as wrangler reads it.
DB_ID="$(node -e 'import("wrangler").then((w) => console.log(w.unstable_readConfig({ config: "./wrangler.toml" }).d1_databases.find((d) => d.binding === "CONTROL_DB").database_id))')"

if [ "$MODE" = dry-run ]; then
  say "dry run: bundling without uploading"
  CI=1 npx --no-install wrangler deploy --dry-run --outdir "$HERE/.deploy-dry-run"
  [ "$DB_ID" != "00000000-0000-0000-0000-000000000000" ] || echo "NOTE: wrangler.toml's D1 database_id is still the placeholder; a real deploy refuses it."
  echo "dry run OK: nothing was sent to Cloudflare"
  exit 0
fi

[ "$DB_ID" != "00000000-0000-0000-0000-000000000000" ] \
  || fail "wrangler.toml's D1 database_id is the placeholder; run \`wrangler d1 create citadel-control\` and paste its id (DEPLOY.md step 2)"

say "Stripe: the catalogue matches billing/tiers.json (read-only)"
node "$ROOT/scripts/stripe-catalogue.mjs" "$CITADEL_STRIPE_KEY_FILE"

say "secrets: every required one is set"
SECRETS_JSON="$(CLOUDFLARE_API_TOKEN="$TOKEN" CI=1 npx --no-install wrangler secret list --format json 2>/dev/null)" \
  || fail "could not list the Worker's secrets (does citadel-tenant exist? DEPLOY.md step 4 creates it with its secrets)"
missing="$(printf '%s' "$SECRETS_JSON" | node -e '
  let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
    const have = new Set(JSON.parse(s).map((x) => x.name));
    console.log(process.argv.slice(1).filter((n) => !have.has(n)).join(" "));
  });' "${REQUIRED_SECRETS[@]}")"
[ -z "$missing" ] || fail "secrets not set: $missing (wrangler secret put <NAME>; DEPLOY.md step 4)"
echo "set: ${REQUIRED_SECRETS[*]}"

say "Durable Objects: no deleted class keeps a live binding name"
# The API refuses that (code 10061) only after the build and the D1 migrations, and the dry run
# cannot see it, so ask the live Worker first (do-binding-rule.mjs; DEPLOY.md).
CLOUDFLARE_API_TOKEN="$TOKEN" node "$HERE/check-do-bindings.mjs" ./wrangler.toml

say "bundle: what wrangler would upload (dry run)"
wr deploy --dry-run --outdir "$HERE/.deploy-dry-run"

say "D1: the migrations a deploy would apply (remote, read-only)"
wr d1 migrations list citadel-control --remote

if [ "$MODE" = preflight ]; then
  echo "preflight OK: every check passed; nothing was changed on Cloudflare"
  exit 0
fi

say "D1: migrations, remote"
wr d1 migrations apply citadel-control --remote

say "deploy"
wr deploy

say "smoke: the deployed site and a tenant host"
# Newly attached routes take seconds to reach the edge; until then the proxied placeholder record
# answers 522. Wait for them, but only that long: a site still failing after 60s is a failed deploy.
page=""
for _ in $(seq 1 12); do
  page="$(curl -fsS https://work.avarok.net/create 2>/dev/null)" && break
  page=""; sleep 5
done
[ -n "$page" ] || fail "https://work.avarok.net/create did not answer within 60s"
printf '%s' "$page" | grep -q 'name="citadel-control-plane" content="/api"' || fail "the page does not carry the control-plane meta tag"
curl -fsSI https://work.avarok.net/ | grep -qi '^content-security-policy:.*challenges.cloudflare.com' || fail "the page's CSP does not allow Turnstile"
status="$(curl -s -o /dev/null -w '%{http_code}' https://smoke-probe.work.avarok.net/)"
[ "$status" = 426 ] || fail "a tenant host answered a plain request with $status, not 426"

echo "deploy OK"
