#!/bin/bash
# Script to synchronize WASM clients across all dependency locations
# This ensures the WASM build is consistent across all three TypeScript client directories

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Check if we're in the right directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
WORKSPACE_ROOT="$SCRIPT_DIR"
INTERNAL_SERVICE_ROOT="$WORKSPACE_ROOT/citadel-internal-service"
NO_RESTART=false

# Check to see if --no-restart was passed
if [ "$1" == "--no-restart" ]; then
    NO_RESTART=true
fi

# Detect container mode
if [ -n "$CONTAINER_MODE" ] && [ "$CONTAINER_MODE" = "1" ]; then
    print_status "Running in container mode"
    IN_CONTAINER=true
else
    IN_CONTAINER=false
fi

if [ ! -d "$INTERNAL_SERVICE_ROOT" ]; then
    print_error "citadel-internal-service directory not found at $INTERNAL_SERVICE_ROOT"
    print_error "Make sure to git submodule pull resursively"
    print_error "  ├── citadel-workspace/"
    print_error "     └── citadel-internal-service/"
    print_error "       └── intersession-layer-messaging/"
    exit 1
fi

# Set destination paths - same for both container and local mode
# In container mode, these paths will be mounted from the host
DEST1="$INTERNAL_SERVICE_ROOT/typescript-client"
DEST2="$WORKSPACE_ROOT/citadel-workspaces/public/wasm"
DEST3="$WORKSPACE_ROOT/citadel-workspace-client-ts/"

# Ensure destination directories exist
mkdir -p "$DEST1" "$DEST2" "$DEST3"

# Validate the tracked package.json BEFORE any destructive step. The clean step below
# wipes public/wasm, so a check that only runs later (as it once did, after the copy)
# turns a bad package.json into a dead dev environment: the browser fetches an empty
# /wasm/ directory, WASM init fails, and every internal-service operation silently
# no-ops. Failing here leaves the previous, working artifacts untouched.
if ! grep -q '"build"' "$DEST1/package.json" 2>/dev/null; then
    print_error "CRITICAL: $DEST1/package.json is missing its build script."
    print_error "It is tracked in git - restore it with:"
    print_error "  git -C \"$INTERNAL_SERVICE_ROOT\" checkout -- typescript-client/package.json"
    exit 1
fi
print_status "package.json intact (tracked file preserved)"

print_status "Starting WASM client synchronization..."

# Step 0: Clean
print_status "Cleaning previous build artifacts..."
rm -f "$DEST1"/*.wasm "$DEST1"/*.d.ts "$DEST1"/*.js 2>/dev/null || true
rm -rf "$DEST1/dist" 2>/dev/null || true
# Emptied, not removed: under Docker this is a mount point (see the
# sync_tsclient_node_modules volume) and `rm -rf` on one fails with EBUSY.
mkdir -p "$DEST1/node_modules"
find "$DEST1/node_modules" -mindepth 1 -maxdepth 1 -exec rm -rf {} + 2>/dev/null || true
# NOTE: $DEST1/package.json is tracked in git and is the single source of truth for this
# package's name, exports, scripts and dependencies. It is deliberately NOT deleted or
# rewritten here. wasm-pack emits its own package.json into pkg/, but the copy step below
# only takes *.wasm/*.js/*.d.ts, so the tracked file is never overwritten. Rewriting it from
# a copy embedded in this script is what previously stripped its "scripts" and "dependencies"
# blocks, which broke `npm run build` and left every downstream typecheck resolving a stale dist.
echo "Cleaned $DEST1"

# NOT cleaned here. public/wasm is wiped just before the copy below, once the
# build has actually produced artifacts to replace it with.
#
# Wiping at this point meant any failure between here and the copy -- a compile
# error is the common one -- left the directory empty. The browser then fetches
# /wasm/*_bg.wasm, gets a 404, WASM init throws, and EVERY internal-service
# operation silently no-ops: register and login do nothing, with no error that
# names the cause. A failed build should leave the previous working artifacts
# exactly where they were.

# Step 1: Build the WASM client
print_status "Building WASM client from citadel-internal-service..."
cd "$INTERNAL_SERVICE_ROOT/citadel-internal-service-wasm-client"

# Check if wasm-pack is installed
if ! command -v wasm-pack &> /dev/null; then
    print_error "wasm-pack is not installed!"
    print_error "Please install it with: curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh"
    exit 1
fi

# Clean previous build
if [ -d "pkg" ]; then
    print_status "Cleaning previous WASM build..."
    rm -rf pkg
fi

# Clear any node_modules caches and build artifacts
print_status "Clearing node_modules caches and build artifacts..."
find "$WORKSPACE_ROOT" -name ".cache" -type d -path "*/node_modules/*" -exec rm -rf {} + 2>/dev/null || true
find "$WORKSPACE_ROOT" -name ".vite" -type d -exec rm -rf {} + 2>/dev/null || true

# Clear Vite dist folder which may contain old WASM files
if [ -d "$WORKSPACE_ROOT/citadel-workspaces/dist" ]; then
    print_status "Clearing Vite dist folder..."
    # Emptied, not removed: mount point under Docker (sync_ui_dist volume).
    mkdir -p "$WORKSPACE_ROOT/citadel-workspaces/dist"
    find "$WORKSPACE_ROOT/citadel-workspaces/dist" -mindepth 1 -maxdepth 1 -exec rm -rf {} + 2>/dev/null || true
fi

# Clear any .vite cache in the workspace
if [ -d "$WORKSPACE_ROOT/citadel-workspaces/.vite" ]; then
    print_status "Clearing .vite cache..."
    rm -rf "$WORKSPACE_ROOT/citadel-workspaces/.vite"
fi

# Clear node_modules/.vite if it exists
if [ -d "$WORKSPACE_ROOT/citadel-workspaces/node_modules/.vite" ]; then
    print_status "Clearing node_modules/.vite cache..."
    rm -rf "$WORKSPACE_ROOT/citadel-workspaces/node_modules/.vite"
fi

# Build WASM 
print_status "Running wasm-pack build..."
wasm-pack build --target web --out-dir pkg

if [ ! -d "pkg" ]; then
    print_error "WASM build failed - pkg directory not created"
    exit 1
fi

# Step 2: Generate TypeScript types
print_status "Generating TypeScript types..."
if [ -f "$INTERNAL_SERVICE_ROOT/generate_types.sh" ]; then
    cd "$INTERNAL_SERVICE_ROOT"
    chmod +x generate_types.sh
    ./generate_types.sh
else
    print_warning "generate_types.sh not found, skipping TypeScript type generation"
fi


# Step 3: Copy WASM files to all locations
print_status "Copying WASM files to all client locations..."

# Copy to citadel-internal-service/typescript-client
if [ -d "$DEST1" ]; then
    print_status "Copying to $DEST1..."
    cp "$INTERNAL_SERVICE_ROOT/citadel-internal-service-wasm-client/pkg/"*.wasm "$DEST1/"
    cp "$INTERNAL_SERVICE_ROOT/citadel-internal-service-wasm-client/pkg/"*.js "$DEST1/"
    cp "$INTERNAL_SERVICE_ROOT/citadel-internal-service-wasm-client/pkg/"*.d.ts "$DEST1/"
    # package.json is validated up front, before the clean step - the copy above only
    # takes *.wasm/*.js/*.d.ts, so nothing in this script can clobber it anymore.

    # Add cache busting to WASM loader
    TIMESTAMP=$(date +%s)
    if [ -f "$DEST1/citadel_internal_service_wasm_client.js" ]; then
        # Add timestamp query parameter to WASM URL (cross-platform sed)
        if [[ "$OSTYPE" == "darwin"* ]]; then
            sed -i '' "s/citadel_internal_service_wasm_client_bg\.wasm/citadel_internal_service_wasm_client_bg.wasm?v=$TIMESTAMP/g" "$DEST1/citadel_internal_service_wasm_client.js"
        else
            sed -i "s/citadel_internal_service_wasm_client_bg\.wasm/citadel_internal_service_wasm_client_bg.wasm?v=$TIMESTAMP/g" "$DEST1/citadel_internal_service_wasm_client.js"
        fi
    fi
    
    # Rebuild TypeScript client after copying new WASM files
    print_status "Rebuilding TypeScript client in $DEST1..."
    cd "$DEST1"

    # Always install dependencies (since we clean node_modules in step 0)
    print_status "Installing npm dependencies..."
    npm install

    print_status "Running TypeScript build..."
    npm run build
fi

# Note: wasm-client-ts is actually just citadel-internal-service/typescript-client
# which is already handled above as DEST1

# Copy to citadel-workspace/citadel-workspaces/public/wasm
if [ -d "$DEST2" ]; then
    # Deferred to here, deliberately: see the note where the old clean step was.
    # By this line wasm-pack has succeeded, so replacing the previous artifacts
    # is safe -- there is something to replace them WITH.
    print_status "Cleaning $DEST2 now that a build exists..."
    rm -rf "$DEST2"/* 2>/dev/null || true

    print_status "Copying to $DEST2..."
    cp "$INTERNAL_SERVICE_ROOT/citadel-internal-service-wasm-client/pkg/"*.wasm "$DEST2/"
    cp "$INTERNAL_SERVICE_ROOT/citadel-internal-service-wasm-client/pkg/"*.js "$DEST2/"
    cp "$INTERNAL_SERVICE_ROOT/citadel-internal-service-wasm-client/pkg/"*.d.ts "$DEST2/"
    
    # Add cache busting to WASM loader
    print_status "Adding cache busting to WASM loader..."
    TIMESTAMP=$(date +%s)
    if [ -f "$DEST2/citadel_internal_service_wasm_client.js" ]; then
        # Add timestamp query parameter to WASM URL (cross-platform sed)
        if [[ "$OSTYPE" == "darwin"* ]]; then
            sed -i '' "s/citadel_internal_service_wasm_client_bg\.wasm/citadel_internal_service_wasm_client_bg.wasm?v=$TIMESTAMP/g" "$DEST2/citadel_internal_service_wasm_client.js"
        else
            sed -i "s/citadel_internal_service_wasm_client_bg\.wasm/citadel_internal_service_wasm_client_bg.wasm?v=$TIMESTAMP/g" "$DEST2/citadel_internal_service_wasm_client.js"
        fi
    fi
fi

# Step 4: Copy to citadel-workspace-client-ts/pkg
#
# DEST3 was declared and mkdir'd at the top of this script and then never
# written to, so the tracked copy under citadel-workspace-client-ts/pkg drifted
# away from the two live ones. It is not unmaintained, which is what makes it
# dangerous: citadel-workspace-internal-service/build.rs writes the same path,
# so an ordinary `cargo build` refreshes it while a sync does not. Two producers
# for one tracked artifact means whichever ran last wins, silently.
#
# No cache-busting rewrite here on purpose. That `?v=$TIMESTAMP` edit is what
# makes the other two copies byte-different on every run; leaving it off keeps
# this copy comparable to build.rs output.
if [ -d "$DEST3/pkg" ] || mkdir -p "$DEST3/pkg"; then
    print_status "Copying to $DEST3/pkg..."
    cp "$INTERNAL_SERVICE_ROOT/citadel-internal-service-wasm-client/pkg/"*.wasm "$DEST3/pkg/"
    cp "$INTERNAL_SERVICE_ROOT/citadel-internal-service-wasm-client/pkg/"*.js "$DEST3/pkg/"
    cp "$INTERNAL_SERVICE_ROOT/citadel-internal-service-wasm-client/pkg/"*.d.ts "$DEST3/pkg/"
fi

# Step 5: Copy TypeScript types if they were generated
if [ -d "$INTERNAL_SERVICE_ROOT/citadel-internal-service-types/bindings" ]; then
    print_status "Copying TypeScript types..."
    
    # Copy to citadel-workspace-client-ts
    TYPES_DEST="$WORKSPACE_ROOT/citadel-workspace-client-ts/src/types"
    if [ -d "$TYPES_DEST" ]; then
        cp "$INTERNAL_SERVICE_ROOT/citadel-internal-service-types/bindings/"*.ts "$TYPES_DEST/" 2>/dev/null || true
    fi
fi

# Step 5b: The OTHER types crate.
#
# citadel-workspace-types emits its ts-rs bindings the same way, and the client
# package holds a copy under src/types/generated -- but nothing copied it. The
# step above existed for citadel-internal-service-types only, so that copy sat
# six months stale: the client was missing Permission::Themes,
# DomainPermissions.themes and the whole UpdateWorkspaceTheme variant, i.e.
# every type the theming feature added. tsc could not see it because
# toWasmWorkspaceRequest casts through `as unknown as`.
#
# `|| true` is deliberately NOT used here. The internal-service copy above
# tolerates an absent bindings dir because that crate's generation is
# conditional; this one is not, and silently skipping is exactly how the drift
# accumulated. scripts/check-generated-types-fresh.mjs gates it in CI either
# way.
WS_TYPES_BINDINGS="$WORKSPACE_ROOT/citadel-workspace-types/bindings"
WS_TYPES_DEST="$WORKSPACE_ROOT/citadel-workspace-client-ts/src/types/generated"
if [ -d "$WS_TYPES_BINDINGS" ] && [ -d "$WS_TYPES_DEST" ]; then
    print_status "Copying citadel-workspace-types bindings..."
    cp "$WS_TYPES_BINDINGS/"*.ts "$WS_TYPES_DEST/"
else
    print_warning "Skipping citadel-workspace-types bindings: $WS_TYPES_BINDINGS or $WS_TYPES_DEST is missing"
fi

# Step 6: Rebuild citadel-workspace-client-ts
print_status "Rebuilding citadel-workspace-client-ts..."
cd "$WORKSPACE_ROOT/citadel-workspace-client-ts"
rm -rf ./dist
# Emptied, not removed — mount point under Docker; see DEST1 above.
mkdir -p ./node_modules
find ./node_modules -mindepth 1 -maxdepth 1 -exec rm -rf {} + 2>/dev/null || true

print_status "Installing dependencies for citadel-workspace-client-ts..."
npm install

# Build the TypeScript client
print_status "Building TypeScript client..."
npm run build

# Step 7: Restart dev server if running
print_status "Checking for running Vite dev server..."
if pgrep -f "vite" > /dev/null; then
    print_warning "Vite dev server is running. Make sure to use tilt to restart/trigger the 'ui' if it hasn't hot-reloaded automatically"
fi

# Step 8: Verify synchronization
#
# This must compare CONTENT and must exit non-zero. It previously compared
# `stat` sizes and, in the failure branch, only called print_error — which
# echoes and returns 0, so `set -e` saw nothing and the script continued to
# Step 9 and exited 0. Every consumer treats that as success: compose's
# `condition: service_completed_successfully` is satisfied and CI publishes a
# UI image built on top of desynchronized WASM, all while the log reads
# "WASM files are NOT synchronized!". A check whose failure branch cannot fail
# is not a check.
#
# Size is also the wrong comparison. Two builds from different Citadel-Protocol
# revisions land within bytes of each other and routinely tie, so the one
# divergence that matters is exactly the one a size check cannot see.
print_status "Verifying synchronization..."
wasm_digest() {
    shasum -a 256 "$1" 2>/dev/null | cut -d' ' -f1
}
WASM_HASH1=$(wasm_digest "$DEST1/citadel_internal_service_wasm_client_bg.wasm")
WASM_HASH2=$(wasm_digest "$DEST2/citadel_internal_service_wasm_client_bg.wasm")
WASM_HASH3=$(wasm_digest "$DEST3/pkg/citadel_internal_service_wasm_client_bg.wasm")

if [ -z "$WASM_HASH1" ] || [ "$WASM_HASH1" != "$WASM_HASH2" ] || [ "$WASM_HASH1" != "$WASM_HASH3" ]; then
    print_error "❌ WASM files are NOT synchronized — refusing to continue."
    print_error "  typescript-client: ${WASM_HASH1:-missing}"
    print_error "  public/wasm:       ${WASM_HASH2:-missing}"
    print_error "  client-ts/pkg:     ${WASM_HASH3:-missing}"
    print_error ""
    print_error "Continuing past this point builds the UI against a WASM binary"
    print_error "the backend was not built from. Re-run the sync; if it recurs,"
    print_error "one of the two copy steps is not reaching its destination."
    exit 1
fi
print_status "✅ All WASM files are synchronized (sha256: ${WASM_HASH1:0:12})"

# Step 9: Rebuild citadel-workspaces
print_status "Rebuilding citadel-workspaces..."
cd "$WORKSPACE_ROOT/citadel-workspaces"
# Emptied, not removed: mount point under Docker (sync_ui_dist volume).
mkdir -p ./dist
find ./dist -mindepth 1 -maxdepth 1 -exec rm -rf {} + 2>/dev/null || true

# Empty node_modules rather than deleting it. Under Docker it is a mount point
# (see the sync_ui_node_modules volume in docker-compose.yml), and `rm -rf` on a
# mount point fails with EBUSY — which, with `set -e` above, would abort the
# whole sync rather than just this step. Emptying works in both cases, and
# `mkdir -p` covers a first native run where the directory does not exist yet.
mkdir -p ./node_modules
find ./node_modules -mindepth 1 -maxdepth 1 -exec rm -rf {} +

print_status "Installing dependencies for citadel-workspaces.."
# Use --package-lock=false to avoid platform-specific lockfile issues when running in Docker.
# Use --legacy-peer-deps because @vitejs/plugin-react-swc's peer dep
# range (vite ^4 || ^5 || ^6 || ^7) trips npm's modern ERESOLVE
# resolver under certain registry/cache states even when the local
# devDep (`vite ^5.4.1`) satisfies it — observed as an intermittent
# CI failure on the integration-test matrix where sync-wasm-client
# would exit 1 with `Found: vite@undefined` mid-resolve. Legacy
# resolution treats peer deps as advisory rather than transactional,
# which is the historical npm behavior and matches what the rest of
# our workspace npm-ci flow uses.
npm install --package-lock=false --legacy-peer-deps

# Drop the Playwright copies this install just placed here.
#
# `--package-lock=false` resolves fresh, so it installs whatever version the
# range allows rather than the one the root lockfile pins. The result is TWO
# Playwright installs: `npx` picks the root's, while `require()` walks up from
# integration-tests and finds this one. They disagree about which browser build
# to use, and the failure is a browser path with an impossible build number
# (chromium-1234) and a "Please run npx playwright install" banner that does not
# help, because installing browsers is not the problem.
#
# Removed rather than pinned: nothing under citadel-workspaces/ needs Playwright
# at all — the tests live in integration-tests/ and resolve from the root.
if [ -d node_modules/playwright ] || [ -d node_modules/playwright-core ] || [ -d node_modules/@playwright ]; then
    print_status "Removing Playwright from citadel-workspaces/node_modules (it shadows the root install)"
    rm -rf node_modules/playwright node_modules/playwright-core node_modules/@playwright
fi

# Recreate symlinks for WASM client (removed when node_modules was deleted)
print_status "Recreating symlinks for citadel-internal-service-wasm-client..."
ln -sf ../../citadel-internal-service/typescript-client node_modules/citadel-internal-service-wasm-client

# Also create symlink at root node_modules for Vite resolution
# (Vite resolves imports from citadel-workspace-client-ts/dist/ up to /workspace/node_modules/)
mkdir -p "$WORKSPACE_ROOT/node_modules"
ln -sf ../citadel-internal-service/typescript-client "$WORKSPACE_ROOT/node_modules/citadel-internal-service-wasm-client"

npx vite build --mode development

print_status "WASM client synchronization complete!"
print_status ""
print_status "To use this in your development workflow:"
print_status "1. Make changes to the WASM client in citadel-internal-service"
print_status "2. Run: $SCRIPT_DIR/sync-wasm-clients.sh (as you have)"
print_status "3. Restart your dev server if it's running (will be automated below unless --no-restart) is passed"

# Step 10: Restart dev server if not disabled
if [ "$NO_RESTART" != "true" ]; then
    print_status "Restarting dev server..."
    tilt trigger server && tilt trigger internal-service
fi
