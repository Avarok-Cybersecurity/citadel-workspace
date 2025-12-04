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

# Define the correct package.json content for typescript-client
TYPESCRIPT_CLIENT_PACKAGE_JSON=$(cat << 'EOF'
{
  "name": "citadel-internal-service-wasm-client",
  "type": "module",
  "version": "0.1.0",
  "files": [
    "citadel_internal_service_wasm_client_bg.wasm",
    "citadel_internal_service_wasm_client.js",
    "citadel_internal_service_wasm_client.d.ts",
    "src/**/*",
    "dist/**/*"
  ],
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "require": "./dist/index.js",
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "clean": "rm -rf dist"
  },
  "sideEffects": [
    "./snippets/*"
  ],
  "dependencies": {
    "ws": "^8.0.0",
    "uuid": "^9.0.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "@types/node": "^20.0.0",
    "@types/ws": "^8.0.0",
    "@types/uuid": "^9.0.0"
  }
}
EOF
)

print_status "Starting WASM client synchronization..."

# Step 0: Clean
if rm -f $DEST1/*.wasm $DEST1/*.d.ts $DEST1/*.js 2>/dev/null ; then 
    rm -rf $DEST1/dist/*
    rm -rf $DEST1/node_modules/*
    echo "Cleaned $DEST1"
fi

if rm -rf $DEST2/* 2>/dev/null ; then 
    echo "Cleaned $DEST2"
fi

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
    rm -rf "$WORKSPACE_ROOT/citadel-workspaces/dist"
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
    # Restore the correct package.json
    echo "$TYPESCRIPT_CLIENT_PACKAGE_JSON" > "$DEST1/package.json"
    
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

    # Verify package.json has build script (resilience check)
    if ! grep -q '"build"' package.json; then
        print_warning "package.json missing 'build' script - regenerating..."
        echo "$TYPESCRIPT_CLIENT_PACKAGE_JSON" > package.json
    fi

    if [ ! -d "node_modules" ]; then
        npm install
    fi
    npm run build
fi

# Note: wasm-client-ts is actually just citadel-internal-service/typescript-client
# which is already handled above as DEST1

# Copy to citadel-workspace/citadel-workspaces/public/wasm
if [ -d "$DEST2" ]; then
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

# Step 5: Copy TypeScript types if they were generated
if [ -d "$INTERNAL_SERVICE_ROOT/citadel-internal-service-types/bindings" ]; then
    print_status "Copying TypeScript types..."
    
    # Copy to citadel-workspace-client-ts
    TYPES_DEST="$WORKSPACE_ROOT/citadel-workspace-client-ts/src/types"
    if [ -d "$TYPES_DEST" ]; then
        cp "$INTERNAL_SERVICE_ROOT/citadel-internal-service-types/bindings/"*.ts "$TYPES_DEST/" 2>/dev/null || true
    fi
fi

# Step 6: Rebuild citadel-workspace-client-ts
print_status "Rebuilding citadel-workspace-client-ts..."
cd "$WORKSPACE_ROOT/citadel-workspace-client-ts"
rm -rf ./dist ./node_modules

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
print_status "Verifying synchronization..."
WASM_SIZE1=$(stat -f%z "$DEST1/citadel_internal_service_wasm_client_bg.wasm" 2>/dev/null || stat -c%s "$DEST1/citadel_internal_service_wasm_client_bg.wasm" 2>/dev/null || echo "0")
WASM_SIZE3=$(stat -f%z "$DEST2/citadel_internal_service_wasm_client_bg.wasm" 2>/dev/null || stat -c%s "$DEST2/citadel_internal_service_wasm_client_bg.wasm" 2>/dev/null || echo "0")

if [ "$WASM_SIZE1" = "$WASM_SIZE3" ] && [ "$WASM_SIZE1" != "0" ]; then
    print_status "✅ All WASM files are synchronized (size: $WASM_SIZE1 bytes)"
else
    print_error "❌ WASM files are NOT synchronized!"
    print_error "  typescript-client: $WASM_SIZE1 bytes"
    print_error "  public/wasm: $WASM_SIZE3 bytes"
fi

# Step 9: Rebuild citadel-workspaces
print_status "Rebuilding citadel-workspaces..."
cd "$WORKSPACE_ROOT/citadel-workspaces"
rm -rf ./dist ./node_modules

print_status "Installing dependencies for citadel-workspaces.."
npm install
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
