#!/usr/bin/env bash
# Builds the UI's production bundle into ui-dist/, the directory wrangler.toml's [assets] serves.
# ui-dist/ is build output: gitignored, never committed, rebuilt by every deploy (deploy.sh).
#
# Needs the parent repo's submodules checked out -- citadel-workspaces (the UI) at the revision
# to ship, and citadel-internal-service (its typescript-client) -- and Node >= 22.
#
# The steps are the production Docker image's (docker/ui/Dockerfile, build stage), in the repo's
# own npm workspace instead of a flattened copy: the root lockfile, the two client packages built
# before the UI that imports them, then `vite build`.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
UI="$ROOT/citadel-workspaces"
TS_CLIENT="$ROOT/citadel-internal-service/typescript-client"
WS_CLIENT="$ROOT/citadel-workspace-client-ts"
OUT="$HERE/ui-dist"

fail() { echo "build-ui: $*" >&2; exit 1; }

for pkg in "$UI" "$TS_CLIENT" "$WS_CLIENT"; do
  [ -f "$pkg/package.json" ] || fail "$pkg is not checked out (git submodule update --init citadel-workspaces citadel-internal-service)"
done

# The browser's WASM client: the tracked, source-stamped build in citadel-workspace-client-ts/pkg,
# the binary CI tests against (SKIP_WASM_BUILD=1). sync-wasm-clients.sh rebuilds it from source;
# this copies it to the two places the build reads it from, as that script does -- the
# typescript-client imports the JS glue, and the page fetches /wasm/*_bg.wasm at runtime.
WASM_PKG="$WS_CLIENT/pkg"
WASM_FILES=(
  citadel_internal_service_wasm_client.js
  citadel_internal_service_wasm_client.d.ts
  citadel_internal_service_wasm_client_bg.wasm
  citadel_internal_service_wasm_client_bg.wasm.d.ts
)
for f in "${WASM_FILES[@]}"; do [ -s "$WASM_PKG/$f" ] || fail "$WASM_PKG/$f is missing"; done
mkdir -p "$UI/public/wasm"
for f in "${WASM_FILES[@]}"; do cp "$WASM_PKG/$f" "$TS_CLIENT/$f"; cp "$WASM_PKG/$f" "$UI/public/wasm/$f"; done

(cd "$ROOT" && npm ci --no-audit --no-fund)
(cd "$TS_CLIENT" && npm run build)
(cd "$WS_CLIENT" && npm run build)
(cd "$UI" && NODE_ENV=production npm run build)

# The page must ship its three meta tags EMPTY: the Worker fills them in (control/ui.mjs), and a
# tag that is missing, or already set, would silently not say what this deployment is.
for name in citadel-loopback-agent citadel-default-server citadel-control-plane; do
  grep -q "name=\"$name\" content=\"\"" "$UI/dist/index.html" || fail "dist/index.html has no empty <meta name=\"$name\">"
done
[ -s "$UI/dist/wasm/citadel_internal_service_wasm_client_bg.wasm" ] || fail "dist/ has no WASM client"

rm -rf "$OUT"
cp -R "$UI/dist" "$OUT"
echo "build-ui: $(find "$OUT" -type f | wc -l | tr -d ' ') files in $OUT (UI $(git -C "$UI" rev-parse --short HEAD))"
