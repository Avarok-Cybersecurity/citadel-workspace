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

# Fail fast if the operator forgot to replace the .env.example
# placeholder. The server binary already refuses to start on
# `__CHANGE_ME__` (kernel/main.rs), but reaching that error means the
# deploy script has already pulled code, built every Docker image
# (multi-minute), and started containers — only to crash with a
# message the operator could have seen instantly. This pre-build
# check turns "fail in 5 minutes" into "fail in 5 seconds" for the
# single most common misconfiguration.
#
# Check ONLY the effective WORKSPACE_MASTER_PASSWORD value, not the whole
# file: .env.example's comments legitimately mention `__CHANGE_ME__` to
# document the contract, so `cp .env.example .env` + editing only the
# assignment would leave the marker in a comment and a whole-file grep
# would wrongly reject a correctly-edited file.
master_pw=$(grep -E '^[[:space:]]*WORKSPACE_MASTER_PASSWORD=' .env | tail -n1 | cut -d= -f2-)
master_pw="${master_pw%$'\r'}"                                # strip CR
master_pw="${master_pw#"${master_pw%%[![:space:]]*}"}"       # trim leading ws
master_pw="${master_pw%"${master_pw##*[![:space:]]}"}"       # trim trailing ws
if [[ -z "$master_pw" || "$master_pw" == *"__CHANGE_ME__"* ]]; then
    echo "ERROR: WORKSPACE_MASTER_PASSWORD is unset or still the __CHANGE_ME__ placeholder."
    echo "  Set it to a real value in .env, e.g.:"
    echo "    openssl rand -hex 32"
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
    # Strip trailing CR so a `.env` created on Windows / transferred via
    # FTP doesn't bake a literal "\r" into every value — that's a
    # very-hard-to-diagnose auth failure for WORKSPACE_MASTER_PASSWORD
    # (server gets "secret\r", operator types "secret"). docker-compose
    # handles CRLF natively; this parser now matches.
    key="${key%$'\r'}"
    value="${value%$'\r'}"
    [[ "$key" =~ ^[[:space:]]*# ]] && continue
    [[ -z "${key// /}" ]] && continue
    # Trim leading/trailing whitespace on the value. If the operator
    # wrote `KEY = value` (with spaces around `=`), `IFS='='` gives
    # value=" value", and the unquoted-export below would bake the
    # leading space into the env var. Any shell consumer probing
    # `${VAR}` then sees " value" (with leading space) — a `nc -z`
    # against ` 12346` rather than `12346` would time out with a
    # confusing "port not bound" error. Trim BEFORE the quote-strip
    # so `KEY = "value"` lands the same as `KEY="value"`.
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    # Strip matching outer quotes (single OR double) — docker-compose's
    # env-file loader does the same so wrapped values land identically.
    if [[ "$value" =~ ^\"(.*)\"$ ]] || [[ "$value" =~ ^\'(.*)\'$ ]]; then
        value="${BASH_REMATCH[1]}"
    fi
    # `export "K=$value"` does NOT re-evaluate `$()` or backticks inside
    # `$value` — parameter expansion happens once and the resulting
    # characters become the literal exported value. Verified with
    # `value='$(date +%s)' export "K=$value" && echo "$K"` → prints
    # `$(date +%s)` literally, not the timestamp. A previous review
    # flagged this as a re-evaluation risk; it isn't, but the test
    # above is worth keeping in mind for any future refactor.
    export "${key// /}=$value"
done < .env
set +a

# When the tunnel profile is requested, TUNNEL_TOKEN must be set — otherwise
# cloudflared starts with an empty token and dies with a confusing error.
# This guard lives here (not as a `${TUNNEL_TOKEN:?}` in the compose file)
# because the compose interpolation is evaluated for every build/config even
# without the tunnel profile, which would break non-tunnel deploys and CI.
if [ "$TUNNEL_PROFILE_ACTIVE" = true ] && [ -z "${TUNNEL_TOKEN:-}" ]; then
    echo "ERROR: --tunnel was passed but TUNNEL_TOKEN is not set in .env."
    echo "  Create a tunnel token at https://one.dash.cloudflare.com and set"
    echo "  TUNNEL_TOKEN=<token> in .env, or deploy without --tunnel."
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

# Step 2: Pull prebuilt images from GHCR.
#
# This used to run `docker compose build`, compiling Rust on the production
# host. That was slow (a full release build per deploy), it required the source
# tree and a toolchain on the box, it left no way back to the previous image,
# and it made every deploy depend on the host's Docker build networking being
# healthy -- which on at least one deployment host it is not (a k3s/Docker
# iptables conflict leaves the default bridge with no egress, so any build
# needing `apt-get` or `npm` fails).
#
# CI now builds and publishes the images (.github/workflows/publish-images.yml)
# and the host simply pulls them. Set IMAGE_TAG to a `sha-<12-char>` tag to
# deploy or roll back to an exact prior build:
#
#     IMAGE_TAG=sha-abc123456789 ./deploy.sh --no-pull
#
# `set -euo pipefail` (top of this file) already aborts the deploy if either of
# the commands below fails, so a failed pull can never fall through to the
# restart step. The explicit checks exist for the OPERATOR, not for control
# flow: a bare `set -e` abort prints nothing, and by far the most likely failure
# here is a 403 because the GHCR packages are still Private (they are created
# that way and must be flipped to Public once). Naming that cause up front turns
# a cryptic mid-deploy exit into a one-line fix.
echo "[2/4] Pulling images (tag: ${IMAGE_TAG:-latest})..."
if ! docker compose -f "$COMPOSE_FILE" "${PROFILE_ARGS[@]}" pull server internal-service; then
    echo "" >&2
    echo "ERROR: failed to pull images (tag: ${IMAGE_TAG:-latest})." >&2
    echo "  Common causes:" >&2
    echo "   * The GHCR packages are still Private. They are created Private;" >&2
    echo "     set each package's visibility to Public, or run 'docker login ghcr.io'." >&2
    echo "   * IMAGE_TAG names a tag that was never published. List them at" >&2
    echo "     https://github.com/orgs/Avarok-Cybersecurity/packages" >&2
    echo "   * The publish workflow has not run yet for this commit." >&2
    echo "  Nothing was restarted; the running stack is untouched." >&2
    exit 1
fi

# Release-consistency gate: the two backend images MUST come from the same commit.
#
# `latest` is a mutable tag on two INDEPENDENT registry repositories, and no registry
# offers an atomic multi-repository tag update. CI advances both in a `promote-latest`
# job that only runs when every image built and passed its smoke test, but a promotion
# that succeeds for `server` and then fails partway (transient registry/auth error)
# would still leave `latest` pointing at a MISMATCHED pair -- and a plain `./deploy.sh`
# would then restart production on two backend versions that never shipped together.
#
# Rather than trusting the tag, verify the artifacts: each image is stamped at build
# time with `org.opencontainers.image.revision` (the commit it was built from). If the
# two disagree, abort BEFORE anything is restarted. This catches a partial promotion,
# a hand-edited tag, or an interrupted deploy alike.
#
# The comparison itself lives in scripts/verify-image-revisions.sh rather than inline
# here, because it is the safety gate and an untested safety gate is a liability. As a
# standalone script that takes images as arguments it is exercised directly in CI
# (validate.yml -> deploy-gate-tests) against real images with matching, mismatched and
# absent labels. Inline in this script - wedged between an image pull and a production
# restart - none of those paths could be tested at all.
echo "  Verifying both images came from the same commit..."
srv_img=$(docker compose -f "$COMPOSE_FILE" config --format json | jq -r '.services.server.image')
is_img=$(docker compose -f "$COMPOSE_FILE" config --format json | jq -r '.services["internal-service"].image')

if ! ./scripts/verify-image-revisions.sh "$srv_img" "$is_img"; then
    echo "" >&2
    echo "  Nothing was restarted; the running stack is untouched." >&2
    exit 1
fi

# The `ui` service is not published to GHCR yet -- its production image bakes
# VITE_WS_URL at build time and its CSP cannot reach an off-origin agent, so a
# published artifact would not actually work until the same-origin `/ws` proxy
# lands. Until then it is still built locally, and only when it is being run.
if docker compose -f "$COMPOSE_FILE" "${PROFILE_ARGS[@]}" config --services | grep -qx "ui"; then
    echo "  Building ui locally (not yet published to GHCR)..."
    if ! docker compose -f "$COMPOSE_FILE" "${PROFILE_ARGS[@]}" build ui; then
        echo "" >&2
        echo "ERROR: failed to build the ui image." >&2
        echo "  Aborting BEFORE restarting anything, so the backend is not left on new" >&2
        echo "  images while the ui stays on its old one." >&2
        exit 1
    fi
fi
echo ""

# NOTE on the removed `target_cache` volume: the production images no longer
# contain cargo, source or a target/ directory, so the build-cache volume was
# dropped from the compose file. A host that ran an older revision may still
# have the named volume lying around, wasting disk.
#
# It is deliberately NOT removed automatically here. Volume names are scoped by
# compose PROJECT name, so the orphan's name depends on the directory the stack
# was deployed from -- and on a shared host that name can collide with a live
# volume owned by an unrelated project (on the current deployment box, a
# `citadel-workspace_target_cache` volume belongs to the CI runner's stack). A
# blind `docker volume rm` in a deploy script could therefore destroy someone
# else's build cache. Remove it by hand, after checking what owns it:
#
#     docker volume ls | grep target_cache
#     docker volume rm <project>_target_cache

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

# Server first (other services depend on it).
#
# No `--build`: the image was pulled in step 2. Leaving `--build` here would
# silently re-compile on the host and defeat the whole point of the registry.
echo "  Restarting server..."
docker compose -f "$COMPOSE_FILE" "${PROFILE_ARGS[@]}" up -d --no-deps server
echo "  Waiting for server to be healthy..."
wait_for_port server 12349
echo "  Server is up."

# Internal service next
echo "  Restarting internal-service..."
docker compose -f "$COMPOSE_FILE" "${PROFILE_ARGS[@]}" up -d --no-deps internal-service
echo "  Waiting for internal-service to be healthy..."
wait_for_port internal-service "${INTERNAL_SERVICE_PORT:-12345}"
echo "  Internal service is up."

# UI last (lightweight, fast restart)
echo "  Restarting ui..."
# No `--build`: the ui image was already built in step 2, BEFORE anything was restarted.
# Rebuilding it here would reopen the exact window step 2 exists to close - a build failure at
# this point (cache invalidation, disk pressure, a transient npm error) would land AFTER the
# server and internal-service have already been swapped to their new images, leaving production
# on a new backend with the old UI. Build everything first, restart afterwards.
docker compose -f "$COMPOSE_FILE" "${PROFILE_ARGS[@]}" up -d --no-deps ui
# Wait for nginx to actually serve (the ui healthcheck does a wget --spider
# on :8080). Without this the deploy reports success even if nginx failed to
# start (bad config, missing dist/) — the cloudflared step would then start
# in front of a dead UI.
wait_for_port ui 8080
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
