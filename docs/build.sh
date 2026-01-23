#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Building Citadel Workspace Plugins documentation..."
cd "$SCRIPT_DIR/plugins"
mdbook build

echo "Documentation built successfully at: $SCRIPT_DIR/plugins/book/"
