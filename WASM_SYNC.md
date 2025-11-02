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

### 2. Package.json Overwriting
`wasm-pack` overwrites `package.json` with minimal content.

**Solution:**
The sync script restores the correct `package.json` with:
```json
{
  "name": "citadel-internal-service-wasm-client",
  "type": "module",
  "version": "0.1.0",
  "files": ["*.wasm", "*.js", "*.d.ts", "src/**/*", "dist/**/*"],
  "main": "src/index.ts",
  "types": "src/index.ts"
}
```

### 3. Import Path Confusion
Vite may try to import from raw WASM files instead of TypeScript wrappers.

**Solution:**
Ensure imports use the TypeScript wrapper:
```typescript
import { InternalServiceWasmClient } from 'citadel-websocket-client';
// NOT from '../citadel_internal_service_wasm_client.js'
```

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

The `citadel-workspace-internal-service/build.rs` script also builds WASM automatically when building the internal service. However, it may not update all locations correctly. Use `sync-wasm-clients.sh` for complete synchronization.

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

## Best Practices

1. **Always use the sync script** after modifying WASM client code
2. **Commit synchronized files** to ensure CI/CD builds work correctly
3. **Test CID handling** with large values to ensure no precision loss
4. **Document WASM API changes** in both Rust and TypeScript sides
5. **Keep package.json files** in sync across all client directories