# WASM Client Build Process

This document describes the automated WASM client build process for the Citadel Workspace project.

## Overview

The `citadel-workspace-internal-service` crate includes a `build.rs` script that automatically:

1. Builds the WASM client from `citadel-internal-service-wasm-client`
2. Copies the built files to the appropriate locations in the workspace
3. Generates and copies TypeScript type definitions

## Automatic Building

The WASM client is automatically rebuilt when you build the workspace internal service:

```bash
cd citadel-workspace/citadel-workspace-internal-service
cargo build
```

## Build Configuration

### Environment Variables

- `SKIP_WASM_BUILD`: Set this to skip WASM building (useful in CI/Docker)
- `FORCE_WASM_BUILD`: Set this to force WASM building in release mode
- `PROFILE`: Automatically set by Cargo (debug/release)

### Examples

```bash
# Normal build (builds WASM in debug mode)
cargo build

# Skip WASM build
SKIP_WASM_BUILD=1 cargo build

# Force WASM build in release mode
FORCE_WASM_BUILD=1 cargo build --release
```

## Prerequisites

- `wasm-pack` must be installed:
  ```bash
  curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh
  ```

- Both repositories must be checked out side by side:
  ```
  parent-directory/
  ├── citadel-workspace/
  └── citadel-internal-service/
  ```

## Output Locations

The built WASM files are copied to:

1. `citadel-workspace/citadel-workspaces/public/wasm/` - For the web UI
2. `citadel-workspace/citadel-workspace-client-ts/pkg/` - For the TypeScript client

TypeScript type definitions are copied to:
- `citadel-workspace/citadel-workspace-client-ts/src/types/`

## Troubleshooting

### WASM build fails

1. Ensure `wasm-pack` is installed
2. Check that both repositories are at the same level
3. Verify you have the latest Rust toolchain

### Types not updating

1. Ensure `generate_types.sh` exists in citadel-internal-service
2. Check that the script has execute permissions
3. Verify `ts-rs` is properly configured in the Rust crates

### Build skipped unexpectedly

Check if `SKIP_WASM_BUILD` is set in your environment or if you're building in release mode without `FORCE_WASM_BUILD`.