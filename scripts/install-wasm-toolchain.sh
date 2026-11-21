#!/usr/bin/env bash
# Install exactly the toolchain scripts/wasm-toolchain.env names, on a Linux
# x86_64 CI runner, and make it the one `rustc` and `wasm-pack` resolve to.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/wasm-toolchain.env
source "$ROOT/scripts/wasm-toolchain.env"
rustup toolchain install "$WASM_RUST_TOOLCHAIN" --profile minimal --target wasm32-unknown-unknown
rustup default "$WASM_RUST_TOOLCHAIN"
dir="wasm-pack-v${WASM_PACK_VERSION}-x86_64-unknown-linux-musl"
curl -sSfL --retry 5 "https://github.com/rustwasm/wasm-pack/releases/download/v${WASM_PACK_VERSION}/${dir}.tar.gz" | tar xz -C "$RUNNER_TEMP"
sudo install "$RUNNER_TEMP/$dir/wasm-pack" /usr/local/bin/wasm-pack
rustc --version
wasm-pack --version
