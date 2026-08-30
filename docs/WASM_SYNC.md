# WASM Client Synchronization Guide

## Overview

The Citadel Workspace project has a complex dependency chain with three TypeScript client directories that all need to stay synchronized with the WASM build. This guide explains the architecture and provides automation for keeping everything in sync.

## Architecture

### Directory Structure
```
── citadel-workspace/
  ├── wasm-client-ts/                        # Mirror of typescript-client
  ├── citadel-workspace-client-ts/           # High-level workspace client
  └── citadel-workspaces/public/wasm/       # Static WASM files for UI
  ├── citadel-internal-service/
     ├── citadel-internal-service-wasm-client/  # Rust WASM source
     ├── typescript-client/                      # Original WASM output location
     └── generate_types.sh                       # TypeScript type generator
```

### Dependency Chain
1. **citadel-internal-service-wasm-client** (Rust)
   - Source of truth for WASM functionality
   - Built with `wasm-pack` to generate JavaScript bindings

2. **typescript-client** (TypeScript/WASM)
   - Original output location for WASM build
   - Contains raw WASM files and JavaScript bindings

3. **wasm-client-ts** (TypeScript/WASM)
   - Mirror copy in workspace repository
   - Provides `InternalServiceWasmClient` class wrapper
   - Referenced by `citadel-workspace-client-ts` via `file:` dependency

4. **citadel-workspace-client-ts** (TypeScript)
   - Extends `InternalServiceWasmClient` with workspace-specific functionality
   - Imports from `citadel-websocket-client` (which resolves to `wasm-client-ts`)

5. **citadel-workspaces** (React UI)
   - Uses `citadel-workspace-client-ts` for all WebSocket communication
   - Also needs WASM files in `public/wasm/` (though not actively used)

## Critical Issues to Avoid

### 1. JavaScript Number Precision Loss
Large CID values (u64 in Rust) can lose precision when converted to JavaScript numbers.

**Problem:**
```javascript
const cid = 2283033082066832407n;
Number(cid) // Returns: 2283033082066832400 (lost precision!)
```

**Solution:**
- Keep CIDs as strings in JavaScript
- Update `convert_string_cids_to_numbers` in WASM client to handle `session_cid`

### 2. package.json is TRACKED — nothing may overwrite it

`citadel-internal-service/typescript-client/package.json` is tracked in git and
is the source of truth for that package: the build/clean/test scripts, the dist
entry points, the exports map and the dependencies. `wasm-pack` emits its own
minimal package.json into `pkg/`, and `build.rs` used to copy a similar minimal
one over the tracked file on every `cargo check`.

**Why this was disproportionately bad.** `sync-wasm-clients.sh` refuses to run
against a package.json with no build script — and it deletes
`citadel-workspaces/public/wasm/*` first. So a sync after any plain
`cargo check` left the browser loading its glue JS while fetching a WASM binary
from an empty directory. WASM init throws, and **every internal-service call
silently no-ops**, registration included. It presents as unrelated UI failures
(login, workspace init, directory navigation) while the internal service logs
nothing but health checks.

**Current behaviour (fixed 2026-08-24):**

- `build.rs` writes a generated package.json ONLY to genuinely generated
  destinations, never to `typescript-client/`.
- `sync-wasm-clients.sh` validates the tracked file BEFORE any destructive step,
  so a bad input fails fast and leaves a working environment behind.
- The copy step takes only `*.wasm`, `*.js` and `*.d.ts`, so nothing in the
  script can clobber it.

**If it happens anyway:**

```bash
git -C citadel-internal-service checkout -- typescript-client/package.json
```

Then re-run the sync. And never `git add -A` after a `cargo check` or a sync in
this repo — that is how the clobbered file got committed twice. Stage explicit
paths.

## Automated Synchronization

### Using the Sync Script

```bash
# Run from citadel-workspace directory
./sync-wasm-clients.sh
```

The script automatically:
1. Builds WASM from source
2. Generates TypeScript types
3. Copies files to all three locations
4. Restores correct package.json files
5. Rebuilds citadel-workspace-client-ts
6. Verifies synchronization

### Manual Build Process

If you need to build manually:

```bash
# 1. Build WASM
cd citadel-internal-service/citadel-internal-service-wasm-client
wasm-pack build --target web --out-dir pkg

# 2. Generate types
cd ../
./generate_types.sh

# 3. Copy WASM files
cp citadel-internal-service-wasm-client/pkg/*.{wasm,js,d.ts} typescript-client/
cp citadel-internal-service-wasm-client/pkg/*.{wasm,js,d.ts} ../citadel-workspace/wasm-client-ts/
cp citadel-internal-service-wasm-client/pkg/*.{wasm,js,d.ts} ../citadel-workspace/citadel-workspaces/public/wasm/

# 4. Copy TypeScript types
cp citadel-internal-service-types/bindings/*.ts ../citadel-workspace/wasm-client-ts/src/types/
cp citadel-internal-service-types/bindings/*.ts ../citadel-workspace/citadel-workspace-client-ts/src/types/

# 5. Rebuild workspace client
cd ../citadel-workspace/citadel-workspace-client-ts
npm run build

# 6. Restart dev server
cd ../citadel-workspaces
pkill -f vite || true
npm run dev
```

## Integration with build.rs

The `citadel-workspace-internal-service/build.rs` script also builds WASM
automatically when building the internal service, and distributes it to the
three consuming locations. It does NOT write `typescript-client/package.json` —
see the section above for why that matters.

Use `sync-wasm-clients.sh` when you want the full pipeline (types, npm builds,
cache-busting) rather than just the binary.

## Troubleshooting

### "unknown variant ConnectionManagement"
The WASM files are out of sync. Run `sync-wasm-clients.sh`.

### "does not provide an export named 'InternalServiceWasmClient'"
Vite is importing from the wrong file. Check import paths in your TypeScript files.

### CID precision loss
Ensure `convert_string_cids_to_numbers` includes all CID field names:
```rust
if (key == "cid" || key == "peer_cid" || key == "session_cid") && v.is_string() {
```

### Changes not appearing in browser
1. Ensure all WASM files are synchronized (check file sizes)
2. Restart the Vite dev server
3. Clear browser cache and hard refresh

### The whole app is broken and the service logs nothing
Check `citadel-workspaces/public/wasm/` is not empty, and that
`citadel-internal-service/typescript-client/package.json` still has its
`scripts` block. An empty wasm directory makes the browser fetch `index.html`
for the `.wasm` URL — the console shows
`expected magic word 00 61 73 6d, found 3c 21 44 4f` (that is `<!DO`). Every
internal-service call then silently does nothing, which looks like a dozen
unrelated bugs at once.

## Best Practices

1. **Always use the sync script** after modifying WASM client code
2. **Commit synchronized files** to ensure CI/CD builds work correctly
3. **Test CID handling** with large values to ensure no precision loss
4. **Document WASM API changes** in both Rust and TypeScript sides
5. **Keep package.json files** in sync across all client directories