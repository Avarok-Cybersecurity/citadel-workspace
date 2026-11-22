# shellcheck shell=bash
# The WASM pkg's build and stamp, sourced by sync-wasm-clients.sh and by
# scripts/regenerate-committed-pkg.sh so both produce and stamp it the same way.
# Needs WORKSPACE_ROOT and INTERNAL_SERVICE_ROOT set by the caller.

# wasm-pack, then the name stripper, in the crate's own pkg/.
#
# Source paths are mapped (scripts/lib/remap-paths.mjs): unmapped, the binary
# carries the building machine's home directory, which every user's console
# printed, and check-no-home-paths-shipped refuses it. Mapped here, in the one
# build both sync-wasm-clients.sh and the pinned CI recipe
# (regenerate-committed-pkg.sh) run, so the committed pkg and a developer's
# sync are built the same way. Assigned before use, so a failure stops the build.
build_wasm_pkg() {
    local crate="$INTERNAL_SERVICE_ROOT/citadel-internal-service-wasm-client"
    local remap
    remap="$(node "$WORKSPACE_ROOT/scripts/remap-path-env.mjs" --toolchain-dir "$crate" wasm32-unknown-unknown)" || return 1
    rm -rf "$crate/pkg"
    (cd "$crate" && export "$remap" && wasm-pack build --target web --out-dir pkg) || return 1
    [ -d "$crate/pkg" ] || { echo "ERROR: wasm-pack created no pkg directory" >&2; return 1; }
    node "$WORKSPACE_ROOT/scripts/strip-wasm-names.mjs" "$crate/pkg/citadel_internal_service_wasm_client_bg.wasm"  # 40% of the binary is names
}

# Hash of every tree the WASM binary is built from, in the order
# scripts/wasm-source-trees.txt lists them.
#
# That file is read by the staleness gate too, so the writer and the checker
# cannot disagree about what counts as source. It used to be one hard-coded
# directory here and the same one hard-coded there -- and it was the wrong
# directory: the WASM client's lib.rs imports the connector's messenger, which
# CLAUDE.md names as the P2P send path, so an edit there left the stamp
# unchanged and the gate reported a match over a binary without it.
wasm_source_stamp() {
    local trees
    trees=$(grep -v '^[[:space:]]*#' "$WORKSPACE_ROOT/scripts/wasm-source-trees.txt" | grep -v '^[[:space:]]*$')
    local out=""
    local dir
    while IFS= read -r dir; do
        local hash
        # The build reads the working tree; the stamp names HEAD. Refuse to name a
        # HEAD the working tree does not match, or a dirty build gets a clean stamp.
        if [ -n "$(git -C "$INTERNAL_SERVICE_ROOT" status --porcelain -- "$dir" 2>/dev/null)" ]; then
            echo "ERROR: $dir has uncommitted changes in citadel-internal-service; commit them before stamping" >&2
            return 1
        fi
        hash=$(git -C "$INTERNAL_SERVICE_ROOT" rev-parse "HEAD:$dir" 2>/dev/null) || return 1
        out="${out:+$out }$hash"
    done <<< "$trees"
    printf '%s\n' "$out"
}

# Stamp the TRACKED copy, the one check-wasm-matches-its-source reads. Two
# lines: the source the binary was built from, then the content hash of the pkg
# beside it (scripts/lib/pkg-content-hash.mjs, which the gate also imports).
# Written to a temporary file outside pkg/ (pkg/ is what line two hashes) and
# moved into place only when both succeed, so a failure never leaves a
# truncated stamp that names nothing.
stamp_committed_pkg() {
    local pkg="$1"
    local tmp
    tmp="$(dirname "$pkg")/.wasm-source-tree.tmp"
    if wasm_source_stamp > "$tmp" \
        && node "$WORKSPACE_ROOT/scripts/lib/pkg-content-hash.mjs" "$pkg" >> "$tmp"; then
        mv "$tmp" "$pkg/.wasm-source-tree"
        echo "  Stamped $pkg/.wasm-source-tree"
    else
        rm -f "$tmp"
        echo "  WARNING: could not stamp $pkg; check-wasm-matches-its-source will fail" >&2
        return 1
    fi
}
