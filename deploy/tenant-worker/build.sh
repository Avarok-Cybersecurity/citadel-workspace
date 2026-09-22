#!/usr/bin/env bash
# Build both wasm crates. wasm-pack, not wrangler, owns the build (see wrangler.toml).
set -euo pipefail
cd "$(dirname "$0")"
PROFILE="${PROFILE:---release}"
wasm-pack build server-wasm --target web "$PROFILE" --out-dir pkg --no-typescript
wasm-pack build proof-client --target nodejs "$PROFILE" --out-dir pkg --no-typescript
