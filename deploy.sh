#!/usr/bin/env bash
# =============================================================================
# Citadel Workspace - Deploy / Update Script
# =============================================================================
#
# This script safely updates the running production stack:
#   1. Pulls latest code
#   2. Rebuilds only changed images
#   3. Restarts services sequentially (data-safe, minimal downtime)
#
# Data volumes (server_data, internal_service_data) are NEVER touched.
# Only container images are rebuilt and replaced.
#
# Usage:
#   ./deploy.sh              # Update all services
#   ./deploy.sh --no-pull    # Skip git pull (rebuild from current code)
#   ./deploy.sh --tunnel     # Include Cloudflare tunnel profile
#
# =============================================================================

set -euo pipefail

COMPOSE_FILE="docker-compose.production.yml"
PROFILE_ARGS=""
SKIP_PULL=false

# Parse arguments
for arg in "$@"; do
    case $arg in
        --no-pull)
            SKIP_PULL=true
            ;;
        --tunnel)
            PROFILE_ARGS="--profile tunnel"
            ;;
        *)
            echo "Unknown argument: $arg"
            echo "Usage: $0 [--no-pull] [--tunnel]"
            exit 1
            ;;
    esac
done

echo "============================================"
echo "  Citadel Workspace - Deploy"
echo "============================================"
echo ""

# Check .env exists
if [ ! -f .env ]; then
    echo "ERROR: .env file not found. Copy .env.example and set your values:"
    echo "  cp .env.example .env"
    exit 1
fi

# Step 1: Pull latest code
if [ "$SKIP_PULL" = false ]; then
    echo "[1/4] Pulling latest code..."
    git pull --recurse-submodules
    git submodule update --init --recursive
    echo ""
else
    echo "[1/4] Skipping git pull (--no-pull)"
    echo ""
fi

# Step 2: Rebuild images (only changed layers are rebuilt due to Docker cache)
echo "[2/4] Building images..."
docker compose -f "$COMPOSE_FILE" $PROFILE_ARGS build
echo ""

# Step 3: Rolling restart - update services one at a time
# Data volumes are attached to containers, NOT images. Rebuilding an image
# and restarting a container does NOT affect the volume data.
echo "[3/4] Updating services (data volumes preserved)..."

# Each readiness probe combines:
#   * an outer `timeout` so the inner `until nc -z` cannot hang forever
#     when a container stays running but never opens its port (crash
#     loop, port conflict, bad config), and
#   * a non-zero-exit branch that dumps logs and aborts the deploy
#     before the next service is restarted against a broken dependency.
#
# Previously the readiness checks were `... 2>/dev/null || sleep 15` —
# a silent fallback that hid every failure mode and then restarted the
# UI on top of a dead backend. `set -euo pipefail` couldn't catch the
# failure because the `||` branch suppressed the non-zero exit.
wait_for_port() {
    local svc="$1" port="$2" deadline="${3:-90}"
    if ! timeout "$deadline" docker compose -f "$COMPOSE_FILE" exec "$svc" \
            sh -c "until nc -z 127.0.0.1 ${port} 2>/dev/null; do sleep 2; done"; then
        echo "ERROR: ${svc} did not become healthy within ${deadline}s"
        docker compose -f "$COMPOSE_FILE" logs "$svc" --tail 80
        exit 1
    fi
}

# Server first (other services depend on it)
echo "  Restarting server..."
docker compose -f "$COMPOSE_FILE" $PROFILE_ARGS up -d --no-deps --build server
echo "  Waiting for server to be healthy..."
wait_for_port server 12349
echo "  Server is up."

# Internal service next
echo "  Restarting internal-service..."
docker compose -f "$COMPOSE_FILE" $PROFILE_ARGS up -d --no-deps --build internal-service
echo "  Waiting for internal-service to be healthy..."
wait_for_port internal-service "${INTERNAL_SERVICE_PORT:-12345}"
echo "  Internal service is up."

# UI last (lightweight, fast restart)
echo "  Restarting ui..."
docker compose -f "$COMPOSE_FILE" $PROFILE_ARGS up -d --no-deps --build ui
echo "  UI is up."

# Cloudflared if tunnel profile is active
if [[ "$PROFILE_ARGS" == *"tunnel"* ]]; then
    echo "  Restarting cloudflared..."
    docker compose -f "$COMPOSE_FILE" $PROFILE_ARGS up -d --no-deps cloudflared
    echo "  Cloudflared is up."
fi

echo ""

# Step 4: Verify
echo "[4/4] Verifying deployment..."
docker compose -f "$COMPOSE_FILE" $PROFILE_ARGS ps
echo ""

# Show data volume status
echo "Data volumes (persistent):"
docker volume ls --filter name=server_data --filter name=internal_service_data --format "  {{.Name}}: {{.Driver}}"
echo ""

echo "============================================"
echo "  Deploy complete!"
echo "============================================"
echo ""
echo "Local access:  http://localhost"
echo "WebSocket:     ws://localhost:${INTERNAL_SERVICE_PORT:-12345}"
