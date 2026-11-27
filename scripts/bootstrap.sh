#!/bin/sh
# The one way to set up a clone of this repository, fresh or reused: run it from anywhere inside it.
#
# A clone has no hooks until core.hooksPath points at .githooks, and git says nothing when it does
# not: a commit then skips every gate without --no-verify. The root install switches them on (its
# `prepare` script); the hooks' UI checks then need both TypeScript clients built and the agent
# client's WASM glue in place, or they fail minutes in with an unrelated-looking error. This does all
# of it in order and ends by proving the hooks are on. CI remains the backstop for a clone that skipped
# it: every gate the hooks run is a CI job.
set -eu
cd "$(git rev-parse --show-toplevel)"

major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
if [ "$major" -lt 20 ]; then
  echo "bootstrap: Node 20 or newer must be first on PATH (found: $(node --version 2>/dev/null || echo none))." >&2
  exit 1
fi

git submodule update --init --recursive
npm ci

# The agent client imports the WASM glue beside it; the committed, stamp-verified copy is in pkg/.
for f in citadel_internal_service_wasm_client.js citadel_internal_service_wasm_client.d.ts \
         citadel_internal_service_wasm_client_bg.wasm citadel_internal_service_wasm_client_bg.wasm.d.ts; do
  cp "citadel-workspace-client-ts/pkg/$f" "citadel-internal-service/typescript-client/$f"
done
(cd citadel-internal-service/typescript-client && npm run build)
(cd citadel-workspace-client-ts && npm run build)

node scripts/check-hooks-are-installed.mjs
node scripts/check-node-matches-ci.mjs
node scripts/check-modules-match-lockfile.mjs
echo "bootstrap: ready. Commit as usual; before a push run: node scripts/pre-push-tier.mjs --remote origin"
