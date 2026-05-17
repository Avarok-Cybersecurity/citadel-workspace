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
# Bash array (not a string) so `"${PROFILE_ARGS[@]}"` expands to nothing
# when no profile is selected and to a properly quoted multi-token list
# when one is. Storing "--profile tunnel" as a single string and relying
# on word-splitting (`$PROFILE_ARGS` unquoted) is the classic shell
# gotcha that breaks the moment a value contains whitespace, glob chars,
# or a single empty element.
PROFILE_ARGS=()
TUNNEL_PROFILE_ACTIVE=false
SKIP_PULL=false

# Parse arguments
for arg in "$@"; do
    case $arg in
        --no-pull)
            SKIP_PULL=true
            ;;
        --tunnel)
            PROFILE_ARGS=(--profile tunnel)
            TUNNEL_PROFILE_ACTIVE=true
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

# jq is required by the readiness probe below. Check up front rather than
# letting the probe loop forever against `state=""` parsed from a missing
# `jq` binary.
if ! command -v jq >/dev/null 2>&1; then
    echo "ERROR: 'jq' is required for the readiness probe. Install with:"
    echo "  apt-get install jq   # Debian/Ubuntu"
    echo "  brew install jq      # macOS"
    exit 1
fi

# Load .env into the shell. Docker Compose already auto-reads .env, but the
# wait_for_port probe below shell-expands ${INTERNAL_SERVICE_PORT} BEFORE it
# hands off to docker compose, so an operator who customised the port would
# otherwise have the probe target 12345 (the literal default) while the
# service is bound elsewhere.
#
# We parse `.env` line-by-line rather than `source .env`. `source` runs the
# file as a shell script, so backticks, `$()`, unquoted spaces, etc. in a
# value get evaluated by the shell — convenient for advanced users but a
# silent-misconfiguration footgun for the common case where an operator
# pasted `WORKSPACE_MASTER_PASSWORD=$(date +%s)` expecting docker-compose
# to receive that literal string. This loop skips comments and blank lines,
# strips matching surrounding quotes, and exports verbatim — matching what
# docker-compose itself does with `.env`.
set -a
while IFS='=' read -r key value; do
    [[ "$key" =~ ^[[:space:]]*# ]] && continue
    [[ -z "${key// /}" ]] && continue
    # Strip matching outer quotes (single OR double) — docker-compose's
    # env-file loader does the same so wrapped values land identically.
    if [[ "$value" =~ ^\"(.*)\"$ ]] || [[ "$value" =~ ^\'(.*)\'$ ]]; then
        value="${BASH_REMATCH[1]}"
    fi
    export "${key// /}=$value"
done < .env
set +a

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
docker compose -f "$COMPOSE_FILE" "${PROFILE_ARGS[@]}" build
echo ""

# Step 3: Rolling restart - update services one at a time
# Data volumes are attached to containers, NOT images. Rebuilding an image
# and restarting a container does NOT affect the volume data.
echo "[3/4] Updating services (data volumes preserved)..."

# Readiness probe driven by the compose healthcheck rather than an in-
# container `docker compose exec sh -c "nc -z …"`. Two failure modes the
# exec form had:
#   * `exec` requires a running container — if the container crashes
#     immediately after `up -d` (bad config, port conflict), exec fails
#     with "container not running" while the outer `timeout` reports
#     "did not become healthy within Ns". The error pointed at the wrong
#     cause.
#   * Re-implementing the readiness check in the script duplicated the
#     compose healthcheck. Drift between the two was easy.
#
# Polling `docker compose ps --format json` reads the SAME healthcheck the
# operator defined in `docker-compose.production.yml`, so the script and
# the compose file agree by construction. The probe distinguishes
# "container not running" (exited / no entry in ps) from "container
# running but unhealthy" so the error message is specific.
wait_for_port() {
    local svc="$1" port="$2" deadline="${3:-90}"
    local elapsed=0
    while (( elapsed < deadline )); do
        local entry
        entry=$(docker compose -f "$COMPOSE_FILE" ps "$svc" --format json 2>/dev/null | head -n1 || true)
        if [ -z "$entry" ]; then
            echo "ERROR: ${svc} is not running (no container in compose ps after ${elapsed}s)"
            docker compose -f "$COMPOSE_FILE" logs "$svc" --tail 80
            exit 1
        fi
        # Treat a service whose container exited as a hard failure so
        # the script aborts immediately instead of waiting out the
        # full deadline for a healthcheck that will never run.
        # Use jq so a future docker-compose JSON-formatting change
        # (added whitespace, key reordering, nullable fields) doesn't
        # silently break the regex and leave us looping until timeout.
        local state health
        state=$(echo "$entry" | jq -r '.State // empty')
        health=$(echo "$entry" | jq -r '.Health // empty')
        if [ "$state" = "exited" ] || [ "$state" = "dead" ]; then
            echo "ERROR: ${svc} container ${state} on its own (port ${port} never came up)"
            docker compose -f "$COMPOSE_FILE" logs "$svc" --tail 80
            exit 1
        fi
        if [ "$health" = "healthy" ]; then
            return 0
        fi
        sleep 2
        elapsed=$((elapsed + 2))
    done
    echo "ERROR: ${svc} did not become healthy on port ${port} within ${deadline}s (last health=${health:-<none>})"
    docker compose -f "$COMPOSE_FILE" logs "$svc" --tail 80
    exit 1
}

# Server first (other services depend on it)
echo "  Restarting server..."
docker compose -f "$COMPOSE_FILE" "${PROFILE_ARGS[@]}" up -d --no-deps --build server
echo "  Waiting for server to be healthy..."
wait_for_port server 12349
echo "  Server is up."

# Internal service next
echo "  Restarting internal-service..."
docker compose -f "$COMPOSE_FILE" "${PROFILE_ARGS[@]}" up -d --no-deps --build internal-service
echo "  Waiting for internal-service to be healthy..."
wait_for_port internal-service "${INTERNAL_SERVICE_PORT:-12345}"
echo "  Internal service is up."

# UI last (lightweight, fast restart)
echo "  Restarting ui..."
docker compose -f "$COMPOSE_FILE" "${PROFILE_ARGS[@]}" up -d --no-deps --build ui
echo "  UI is up."

# Cloudflared if tunnel profile is active
if [[ "$TUNNEL_PROFILE_ACTIVE" == "true" ]]; then
    echo "  Restarting cloudflared..."
    docker compose -f "$COMPOSE_FILE" "${PROFILE_ARGS[@]}" up -d --no-deps cloudflared
    echo "  Cloudflared is up."
fi

echo ""

# Step 4: Verify
echo "[4/4] Verifying deployment..."
docker compose -f "$COMPOSE_FILE" "${PROFILE_ARGS[@]}" ps
echo ""

# Show data volume status. Two `--filter name=` flags AND-combine on
# Docker's side, and a single volume can't match two distinct names —
# the original `--filter name=server_data --filter name=internal_service_data`
# always returned an empty list, masking missing-volume problems
# during a deploy. Pipe through grep so the filter is OR-shaped and
# emit an explicit "(no volumes found)" so an empty result never
# silently slips past.
echo "Data volumes (persistent):"
volume_list=$(docker volume ls --format '  {{.Name}}: {{.Driver}}' | grep -E 'server_data|internal_service_data' || true)
if [ -z "$volume_list" ]; then
    echo "  (no persistent volumes found — production state will not survive container removal)"
else
    echo "$volume_list"
fi
echo ""

echo "============================================"
echo "  Deploy complete!"
echo "============================================"
echo ""
echo "Local access:  http://localhost:8080"
echo "WebSocket:     ws://localhost:${INTERNAL_SERVICE_PORT:-12345}"
