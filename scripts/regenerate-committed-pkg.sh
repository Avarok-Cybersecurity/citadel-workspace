#!/usr/bin/env bash
# Rebuild citadel-workspace-client-ts/pkg with the pinned recipe and stamp it.
#
# The committed pkg is the Linux build with scripts/wasm-toolchain.env's exact
# versions: two such builds on different runners are byte-identical, while a
# Mac build is not (see that file). wasm-rebuild-diff runs this and requires no
# change; types-bump runs it after moving the agent pointer. Refuses any other
# toolchain rather than produce bytes CI will not reproduce.
#
# Usage: scripts/regenerate-committed-pkg.sh
set -euo pipefail
WORKSPACE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INTERNAL_SERVICE_ROOT="$WORKSPACE_ROOT/citadel-internal-service"
# shellcheck source=scripts/wasm-toolchain.env
source "$WORKSPACE_ROOT/scripts/wasm-toolchain.env"
# shellcheck source=scripts/lib/wasm-pkg.sh
source "$WORKSPACE_ROOT/scripts/lib/wasm-pkg.sh"

rustc_version=$(cd "$INTERNAL_SERVICE_ROOT" && rustc --version | awk '{print $2}')
pack_version=$(wasm-pack --version | awk '{print $2}')
if [ "$rustc_version" != "$WASM_RUST_TOOLCHAIN" ] || [ "$pack_version" != "$WASM_PACK_VERSION" ]; then
    echo "FAIL: rustc $rustc_version and wasm-pack $pack_version; the committed pkg is built with" >&2
    echo "rustc $WASM_RUST_TOOLCHAIN and wasm-pack $WASM_PACK_VERSION (scripts/wasm-toolchain.env)." >&2
    exit 1
fi
case "$(uname -s)-$(uname -m)" in
    Linux-x86_64) ;;
    *) echo "WARNING: the committed pkg is the Linux x86_64 build; this host's bytes will differ, and wasm-rebuild-diff will say so." >&2 ;;
esac

build_wasm_pkg
DEST="$WORKSPACE_ROOT/citadel-workspace-client-ts/pkg"
for file in citadel_internal_service_wasm_client.js citadel_internal_service_wasm_client.d.ts \
    citadel_internal_service_wasm_client_bg.wasm citadel_internal_service_wasm_client_bg.wasm.d.ts; do
    cp "$INTERNAL_SERVICE_ROOT/citadel-internal-service-wasm-client/pkg/$file" "$DEST/$file"
done
stamp_committed_pkg "$DEST"
