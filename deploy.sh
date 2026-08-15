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

# Serialize the whole mutating deploy, one at a time per compose project.
#
# Everything from here down mutates shared state: the checkout (git pull), the images, the running
# containers, and - since this script now removes containers for services a slimmed compose file
# dropped - containers it did not itself start. That last one is why this matters more than it
# used to. Two overlapping deploys of the same project whose compose files disagree about which
# services exist (an operator slimming the file while a deploy is in flight) would have one run
# force-removing containers the other just started and health-checked, ending in a state matching
# neither invocation. Interleaved `up -d` calls were already unsafe; adding removal made the
# failure destructive rather than merely confusing.
#
# The lock is held for the entire run: the fd stays open until the script exits, by any path,
# including a failed gate or a Ctrl-C. No trap needed - the kernel releases it with the process.
#
# Serialize on the COMPOSE PROJECT - because that is the scope of the state this script mutates. The reconciliation below force-removes containers selected by the
# com.docker.compose.project label, which spans every checkout on the box, so a lock narrower than
# the project leaves the destructive race open exactly where the damage is worst: a slim deploy
# from one directory removing the ui/internal-service containers another deploy just started and
# health-checked. Release-directory and worktree deployments make two checkouts of one project a
# normal operating pattern, not a misconfiguration.
#
# Where the file lives, and exactly what each choice guarantees:
#
#   * $DEPLOY_LOCK_FILE if set - an absolute path, validated because it is opened for writing.
#     This is the ONLY way to get serialization across multiple deploy ACCOUNTS, and it requires
#     provisioning: an administrator creates e.g. /run/lock/citadel-deploy/<project>.lock owned by
#     a group every deploy account belongs to, mode 664. Read from .env like every other setting,
#     so it can be committed to the deployment's environment rather than remembered.
#   * otherwise $HOME/.local/state/citadel-deploy/<project>.lock - covers every deploy made by THIS
#     ACCOUNT, including from different checkouts, and works under cron as well as an interactive
#     shell. NOT ${TMPDIR:-/tmp}: TMPDIR varies between cron, an interactive shell and a
#     PrivateTmp unit, so deploys would lock different inodes and both proceed.
#
# The default deliberately does NOT claim to serialize across accounts, and no default can: a lock
# file one account creates is mode 644, so a second account cannot even open it for append
# (verified) - a shared lock is only possible with a group-writable file somebody provisions, which
# this script has no business creating. Rather than imply a guarantee it cannot keep, the default
# path and its scope are printed on every run, so two operators on one host can see at a glance
# that they hold different locks. Set DEPLOY_LOCK_FILE to close that gap.
#
# The project name is read BEFORE the pull so the lock covers the whole run, and re-read after it
# (below) so a pulled revision that renames the project fails loudly instead of silently leaving
# this run holding the wrong project's lock.
#
# Opened with >> rather than >: truncation serves no purpose (nothing reads the contents) and a
# lock file is not worth a destructive open. Held for the entire run - the fd stays open until the
# process exits by any path, including a failed gate or a Ctrl-C, so no trap is needed.
if ! command -v flock >/dev/null 2>&1; then
    echo "ERROR: flock is required to serialize deploys but was not found." >&2
    echo "  Install util-linux. Running without it risks two concurrent deploys" >&2
    echo "  removing each other's containers." >&2
    exit 1
fi
deploy_project=$(docker compose -f "$COMPOSE_FILE" config --format json | jq -r '.name // empty')
if [ -z "$deploy_project" ]; then
    echo "ERROR: could not read the compose project name from '$COMPOSE_FILE'." >&2
    echo "  It identifies both the containers this deploy manages and the lock that keeps two" >&2
    echo "  deploys from removing each other's. Refusing to continue without it." >&2
    exit 1
fi
# The CANONICAL host-wide lock. The path is a CONSTANT - not derived from any environment
# variable, .env value, or anything else a deploy can choose. That is the entire guarantee: a path
# an operator supplies cannot prove every other deployment of this project supplied the same one,
# so only a constant establishes that all of them contend on a single inode. Holding it is what
# authorizes removing containers matched by the project label, which spans the whole daemon.
#
# It is provisioned once by an administrator (see .env.example) and NEVER created here: a file this
# script created would be one this account happened to make, not the shared one, and authorizing on
# that is the same as authorizing on a path string.
CANONICAL_LOCK="/run/lock/citadel-deploy/${deploy_project}.lock"
RECONCILE_AUTHORIZED=""
canonical_usable=""

# Fail closed on a canonical lock that exists but this account cannot use. Falling back to a
# private lock there would be worse than refusing: this deploy would pull and restart the same
# project unserialized while another account, holding the canonical lock, removed containers.
# The file alone is not enough. `-f`/`-w` follow symlinks, and write permission on the PARENT
# directory allows unlinking whatever is inside it whatever its own mode - so a group-writable
# directory lets one account replace the lock while another holds it: two live inodes, both "the"
# lock, both authorized. Check the surroundings, not just the file.
canonical_surroundings_ok() {
    local dir perm grp oth owner
    dir=$(dirname "$CANONICAL_LOCK")
    [ -L "$CANONICAL_LOCK" ] && { echo "  it is a symlink, not the provisioned file" >&2; return 1; }
    owner=$(stat -c %u "$dir" 2>/dev/null) || { echo "  cannot stat $dir" >&2; return 1; }
    [ "$owner" = "0" ] || { echo "  $dir is not root-owned (uid $owner)" >&2; return 1; }
    perm=$(stat -c %a "$dir" 2>/dev/null) || return 1
    perm=${perm: -3}
    grp=${perm:1:1}; oth=${perm:2:1}
    if [ $(( grp & 2 )) -ne 0 ] || [ $(( oth & 2 )) -ne 0 ]; then
        echo "  $dir is writable by group or others (mode $perm), so the lock file can be replaced" >&2
        return 1
    fi
    return 0
}

if [ -e "$CANONICAL_LOCK" ]; then
    if [ -f "$CANONICAL_LOCK" ] && [ -w "$CANONICAL_LOCK" ] && canonical_surroundings_ok; then
        canonical_usable=1
    else
        echo "ERROR: the canonical deploy lock exists but this account cannot use it:" >&2
        echo "    ${CANONICAL_LOCK}" >&2
        echo "  It must be a regular file, group-writable by every deploy account, inside a" >&2
        echo "  root-owned directory that is NOT group-writable (or the file could be replaced" >&2
        echo "  while another deploy holds it):" >&2
        echo "    sudo install -d -o root -g docker -m 2755 $(dirname "$CANONICAL_LOCK")" >&2
        echo "    sudo install -o root -g docker -m 0664 /dev/null '${CANONICAL_LOCK}'" >&2
        echo "  Refusing rather than falling back to a private lock, which would let this deploy" >&2
        echo "  restart services while another account's deploy is mid-flight." >&2
        exit 1
    fi
fi

if [ -n "${DEPLOY_LOCK_FILE:-}" ]; then
    DEPLOY_LOCK_FILE_EXPLICIT=1
    case "$DEPLOY_LOCK_FILE" in
        /*) ;;
        *)  echo "ERROR: DEPLOY_LOCK_FILE must be an absolute path (got '$DEPLOY_LOCK_FILE')." >&2
            echo "  A relative path would resolve per working directory, which is precisely the" >&2
            echo "  scoping bug this setting exists to avoid." >&2
            exit 1 ;;
    esac
    # Pointing it at the canonical path does not make it the canonical lock. If the file is not
    # already provisioned, the code below would create it under this account's umask - a private
    # file wearing the shared file's name, which would then authorize removal on nothing more than
    # a matching string.
    if [ "$DEPLOY_LOCK_FILE" = "$CANONICAL_LOCK" ] && [ -z "$canonical_usable" ]; then
        echo "ERROR: DEPLOY_LOCK_FILE names the canonical lock, but it is not provisioned." >&2
        echo "  This script will not create it - a file it created would be this account's, not" >&2
        echo "  the shared one. Provision it as an administrator:" >&2
        echo "    sudo install -o root -g docker -m 0664 /dev/null '${CANONICAL_LOCK}'" >&2
        exit 1
    fi
else
    if [ -z "${HOME:-}" ]; then
        echo "ERROR: HOME is not set, so the default lock location cannot be derived." >&2
        echo "  Set DEPLOY_LOCK_FILE to an absolute path shared by every deploy of this project." >&2
        exit 1
    fi
    DEPLOY_LOCK_FILE="$HOME/.local/state/citadel-deploy/${deploy_project}.lock"
fi

# A usable canonical lock IS the lock, overriding any explicit path - announced, never silently.
# It is strictly stronger: host policy rather than one deployment's choice.
if [ -n "$canonical_usable" ]; then
    if [ -n "${DEPLOY_LOCK_FILE_EXPLICIT:-}" ] && [ "$DEPLOY_LOCK_FILE" != "$CANONICAL_LOCK" ]; then
        echo "  NOTE: DEPLOY_LOCK_FILE=${DEPLOY_LOCK_FILE} is overridden by the canonical lock" >&2
        echo "    ${CANONICAL_LOCK} - every deploy of this project must contend on one inode." >&2
    fi
    DEPLOY_LOCK_FILE="$CANONICAL_LOCK"
fi
if ! mkdir -p "$(dirname "$DEPLOY_LOCK_FILE")"; then
    echo "ERROR: cannot create the lock directory '$(dirname "$DEPLOY_LOCK_FILE")'." >&2
    exit 1
fi
if [ -n "$canonical_usable" ]; then
    echo "  Deploy lock: ${DEPLOY_LOCK_FILE} (canonical - every deploy of this project contends here)"
elif [ -n "${DEPLOY_LOCK_FILE_EXPLICIT:-}" ]; then
    echo "  Deploy lock: ${DEPLOY_LOCK_FILE} (serializes accounts configured with this same path)"
else
    echo "  Deploy lock: ${DEPLOY_LOCK_FILE} (this account only)"
fi
# Opened in a subshell first: a failed `exec` redirection makes a non-interactive shell exit
# outright, so the most likely provisioning mistake - a shared lock file another account created
# mode 644 - would otherwise surface as a bare "Permission denied" with no explanation.
if ! ( : >>"$DEPLOY_LOCK_FILE" ) 2>/dev/null; then
    echo "ERROR: cannot open the lock file for writing: ${DEPLOY_LOCK_FILE}" >&2
    if [ -e "$DEPLOY_LOCK_FILE" ]; then
        echo "  It exists but this account cannot write to it. A shared lock has to be" >&2
        echo "  group-writable by every deploy account, e.g.:" >&2
        echo "    sudo install -o root -g docker -m 0664 /dev/null '${DEPLOY_LOCK_FILE}'" >&2
        echo "  (see DEPLOY_LOCK_FILE in .env.example for the full recipe)" >&2
    else
        echo "  The directory is not writable by this account." >&2
    fi
    exit 1
fi

# `flock -w 0` is `flock -n`, so the default preserves fail-immediately. A cron-driven deploy that
# overlaps a long one would otherwise turn a routine queue into a failed-deployment alert, hence
# the opt-in wait.
DEPLOY_LOCK_TIMEOUT="${DEPLOY_LOCK_TIMEOUT:-0}"
case "$DEPLOY_LOCK_TIMEOUT" in
    ''|*[!0-9]*)
        echo "ERROR: DEPLOY_LOCK_TIMEOUT must be a whole number of seconds (got '$DEPLOY_LOCK_TIMEOUT')." >&2
        exit 1 ;;
esac
exec 9>>"$DEPLOY_LOCK_FILE"
if ! flock -w "$DEPLOY_LOCK_TIMEOUT" 9; then
    echo "ERROR: another deploy of project '${deploy_project}' is already running." >&2
    echo "  Lock: ${DEPLOY_LOCK_FILE}" >&2
    if [ "$DEPLOY_LOCK_TIMEOUT" = "0" ]; then
        echo "  Nothing was changed. Wait for it to finish, then re-run, or set" >&2
        echo "  DEPLOY_LOCK_TIMEOUT=<seconds> to queue behind it instead (useful from cron)." >&2
    else
        echo "  Nothing was changed. Waited ${DEPLOY_LOCK_TIMEOUT}s and it is still held." >&2
    fi
    exit 1
fi

# ONLY NOW is reconciliation authorized, and only because the lock just acquired IS the canonical
# one. Tying it to the acquisition rather than to the file's existence is the whole guarantee:
# every deploy that may remove containers is holding the same inode, so no two can be doing it at
# once.
if [ -n "$canonical_usable" ]; then
    RECONCILE_AUTHORIZED=1
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

# The lock is keyed on the project name read before the pull. If the pulled revision renames the
# project, this run would hold one project's lock while restarting and removing another's
# containers - so stop, rather than proceed under a guarantee that no longer applies. Re-running
# picks up the new name and locks it correctly. No images or containers have been touched at this
# point; the CHECKOUT may have moved, since step 1's pull is what introduced the rename.
pulled_project=$(docker compose -f "$COMPOSE_FILE" config --format json | jq -r '.name // empty')
if [ "$pulled_project" != "$deploy_project" ]; then
    echo "ERROR: the pulled revision changes the compose project from '${deploy_project}' to '${pulled_project:-<unreadable>}'." >&2
    echo "  This deploy holds the lock for '${deploy_project}', so it cannot safely act on" >&2
    echo "  '${pulled_project}' containers. No images or containers were changed, but the" >&2
    echo "  checkout may already have been updated by step 1's git pull - re-run, and the deploy" >&2
    echo "  will lock and act under the new project name." >&2
    exit 1
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

# Which services this deployment covers. Derived rather than hardcoded, because
# docker-compose.production.yml documents that `ui` and `internal-service` are droppable for a
# server-only deployment - an operator who takes that option would otherwise hit
# `no such service: ui`, a deploy broken by following our own documentation.
#
# The selection lives in scripts/select-deploy-services.sh so it can be tested directly (see
# validate.yml -> deploy-gate-tests). It is safety-critical in both directions: too few and a
# declared service is silently skipped while the run still reports success; too many and we
# `up -d` a service that was never pulled. Neither is testable wedged inline between a pull
# and a production restart.
# Command substitution, NOT `mapfile < <(...)`. Bash does not propagate the exit status of a
# process substitution: mapfile reads to EOF and returns 0 even when the child exited 1, and it
# KEEPS whatever partial output the child managed to print. An `if ! mapfile` guard there is dead
# code, and a selector that failed after printing one service would have been treated as success
# with a truncated list. Verified both behaviours before changing this.
if ! selection=$(./scripts/select-deploy-services.sh "$COMPOSE_FILE"); then
    exit 1
fi
mapfile -t DEPLOY_SERVICES <<<"$selection"
# Belt and braces: the selector already errors on an empty result, and the check above now
# actually observes that, but a silent empty selection must never fall through to a restart.
if [ "${#DEPLOY_SERVICES[@]}" -eq 0 ] || [ -z "${DEPLOY_SERVICES[0]}" ]; then
    echo "ERROR: no deployable services selected from '$COMPOSE_FILE'." >&2
    exit 1
fi
echo "  Services in this deployment: ${DEPLOY_SERVICES[*]}"

# PREFLIGHT: refuse a deploy we could not finish.
#
# If this compose file drops a service that still has a container running, the deploy is only
# complete once that container is gone - otherwise a slimmed deployment leaves, say, the old ui
# still serving :8080 while automation keyed on the exit status records the new topology as
# applied. That is the silent half-applied deploy this script exists to prevent, so it is checked
# BEFORE anything is pulled or restarted: refusing here leaves the running stack untouched, where
# refusing at the end would report a failure on a deploy that had already changed production.
if ! deployable_all=$(./scripts/select-deploy-services.sh --deployable); then
    exit 1
fi
preflight_project=$(docker compose -f "$COMPOSE_FILE" config --format json | jq -r '.name // empty')
blocked=""
while read -r svc; do
    [ -n "$svc" ] || continue
    printf '%s\n' "${DEPLOY_SERVICES[@]}" | grep -qx "$svc" && continue
    if ! found=$(docker ps -aq \
        --filter "label=com.docker.compose.project=${preflight_project}" \
        --filter "label=com.docker.compose.service=${svc}" \
        --filter "label=com.docker.compose.oneoff=False" 2>/dev/null); then
        echo "ERROR: cannot list containers for the dropped service '${svc}'." >&2
        echo "  Refusing to deploy: this run could not finish the job it was asked to do, and" >&2
        echo "  nothing has been changed yet." >&2
        exit 1
    fi
    [ -n "$found" ] || continue
    blocked="${blocked}${svc} "
done <<<"$deployable_all"

if [ -n "$blocked" ] && [ -z "$RECONCILE_AUTHORIZED" ]; then
    echo "ERROR: '${COMPOSE_FILE}' no longer declares: ${blocked% }" >&2
    echo "  Containers for those services are still running, and this deploy is not authorized to" >&2
    echo "  remove them - removal matches containers by compose project, which spans every account" >&2
    echo "  on this host, so it is only safe when every deploy of this project contends on one" >&2
    echo "  lock. Nothing has been changed." >&2
    echo "" >&2
    echo "  Provision the canonical lock once, as an administrator:" >&2
    echo "    sudo install -d -o root -g docker -m 2755 /run/lock/citadel-deploy" >&2
    echo "    sudo install -o root -g docker -m 0664 /dev/null '${CANONICAL_LOCK}'" >&2
    echo "  and re-run. Or stop those containers yourself first." >&2
    exit 1
fi

# True if $1 is part of THIS deployment - i.e. in the set selected above.
#
# Named for what it tests, deliberately. It is NOT an independent "does the compose file
# declare this?" query, and must not become one: the restart set has to be exactly the set
# that was pulled and revision-checked. A second, independently-derived answer to the same
# question is how you end up running `up -d` on a service whose image was never refreshed.
# One source of truth - DEPLOY_SERVICES - for pull, verify and restart alike.
#
# The rolling restart in step 3 needs this because the restart step used to run
# `up -d --no-deps ui` unconditionally. An operator following the documented server-only
# option got `no such service: ui` AFTER the server had already been swapped to its new
# image - a half-applied deploy, the single outcome this script's ordering exists to prevent.
# Guarding the pull but not the restart just moved the failure to the most expensive moment.
#
# `server` is deliberately NOT guarded: selection already aborts when it is absent, so by this
# point it is guaranteed present, and a guard there would silently turn "the compose file is
# malformed" into "nothing was deployed, exit 0".
in_deployment() {
    printf '%s\n' "${DEPLOY_SERVICES[@]}" | grep -qx "$1"
}

if ! docker compose -f "$COMPOSE_FILE" "${PROFILE_ARGS[@]}" pull "${DEPLOY_SERVICES[@]}"; then
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
# (validate.yml -> deploy-gate-tests) against real images: matching, mismatched, absent
# labels, un-inspectable, and the single-image server-only shape. Inline in this script -
# wedged between an image pull and a production restart - none of those paths could be
# tested at all.
echo "  Verifying all images came from the same commit..."
# Verify exactly the services that were pulled. Every image in the deployment is subject to the
# same consistency rule - the ui included, since a partially completed `latest` promotion could
# otherwise pair a new backend with an old UI, which is precisely the mixed-version deploy this
# gate exists to prevent. Asking for a service the file does not declare would hand the gate a
# literal "null" from jq, which it correctly refuses as un-inspectable; deriving the list from the
# file instead keeps a legitimately slimmed-down deployment working.
compose_json=$(docker compose -f "$COMPOSE_FILE" config --format json)
VERIFY_IMAGES=()
for svc in "${DEPLOY_SERVICES[@]}"; do
    img=$(printf '%s' "$compose_json" | jq -r --arg s "$svc" '.services[$s].image // empty')
    if [ -z "$img" ]; then
        echo "ERROR: service '$svc' declares no image in '$COMPOSE_FILE'." >&2
        echo "  Nothing was restarted; the running stack is untouched." >&2
        exit 1
    fi
    VERIFY_IMAGES+=("$img")
done

if ! ./scripts/verify-image-revisions.sh "${VERIFY_IMAGES[@]}"; then
    echo "" >&2
    echo "  Nothing was restarted; the running stack is untouched." >&2
    exit 1
fi

# All three images are published now, so this host builds NOTHING. The ui used to be built here
# (it baked VITE_WS_URL at build time, so a published image could not have worked); the app now
# derives its socket URL at runtime, so one published ui image serves every deployment.
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

# Internal service next, when this deployment includes one.
if in_deployment internal-service; then
    echo "  Restarting internal-service..."
    docker compose -f "$COMPOSE_FILE" "${PROFILE_ARGS[@]}" up -d --no-deps internal-service
    echo "  Waiting for internal-service to be healthy..."
    wait_for_port internal-service "${INTERNAL_SERVICE_PORT:-12345}"
    echo "  Internal service is up."
else
    echo "  Skipping internal-service: not part of this deployment."
fi

# UI last (lightweight, fast restart), when this deployment includes one.
if in_deployment ui; then
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
else
    echo "  Skipping ui: not part of this deployment."
fi

# Cloudflared if tunnel profile is active
if [[ "$TUNNEL_PROFILE_ACTIVE" == "true" ]]; then
    echo "  Restarting cloudflared..."
    docker compose -f "$COMPOSE_FILE" "${PROFILE_ARGS[@]}" up -d --no-deps cloudflared
    echo "  Cloudflared is up."
fi

# Reconcile services this deployment DROPPED.
#
# `docker compose up` does not remove containers for services the file no longer declares. It
# prints "Found orphan containers ... you can run this command with the --remove-orphans flag"
# and leaves them running - verified directly against docker: redeploying a two-service project
# with a one-service file left the dropped container up.
#
# That matters because of what the restart guards above changed. Redeploying an existing full
# stack with a server-only compose file used to fail loudly at `up -d --no-deps ui` ("no such
# service: ui"). Now that the restart is guarded, the same deploy reports success - while the old
# ui keeps serving a stale image on :8080 and the old internal-service keeps running. Guarding
# the restart without reconciling would just convert a loud half-applied deploy into a silent
# one, which is worse.
#
# Removal is targeted by compose label rather than `--remove-orphans`. That flag removes
# everything in the project the file does not declare, and which containers those are depends on
# the compose version's treatment of profile-gated services - it can include `cloudflared` when
# --tunnel was not passed, taking the tunnel down as a side effect of a routine server deploy.
# This loop only ever considers the services deploy.sh itself manages, and only those the
# current selection excludes, so cloudflared is never a candidate.
#
# It runs AFTER the selected services are up and healthy: if anything above failed we exited
# already, leaving the previous stack untouched. Nothing is torn down until its replacement is
# confirmed running.
#
# Named data volumes are unaffected - `docker rm -f` removes the container, never the volume.
reconcile_failed=""
if ! deployable_all=$(./scripts/select-deploy-services.sh --deployable); then
    exit 1
fi
compose_project=$(printf '%s' "$compose_json" | jq -r '.name // empty')
if [ -z "$compose_project" ]; then
    echo "ERROR: could not determine the compose project name; refusing to guess which" >&2
    echo "  containers belong to this deployment." >&2
    exit 1
fi
while read -r svc; do
    [ -n "$svc" ] || continue
    if in_deployment "$svc"; then
        continue
    fi
    # oneoff=False excludes `docker compose run` containers, which carry the SAME project and
    # service labels as the real ones (verified). Without it, slimming a deployment force-removes
    # a migration or debugging job someone is running against the dropped service - a workload
    # this script never started and has no business killing.
    # A transient daemon error must not fail a deploy whose services are already up and healthy,
    # so a failed query skips this service's cleanup rather than aborting under set -e.
    if ! stale=$(docker ps -aq \
        --filter "label=com.docker.compose.project=${compose_project}" \
        --filter "label=com.docker.compose.service=${svc}" \
        --filter "label=com.docker.compose.oneoff=False" 2>/dev/null); then
        echo "  WARNING: could not list ${svc} containers, so whether one is still running is" >&2
        echo "    unknown - the requested topology cannot be confirmed." >&2
        reconcile_failed=1
        continue
    fi
    [ -n "$stale" ] || continue
    stale_ids=$(printf '%s' "$stale" | tr '\n' ' ')

    # Authorized by the CANONICAL lock only - see its definition. Reaching here unauthorized
    # should be impossible, because the preflight refuses such a deploy before anything is pulled
    # or restarted. Kept as a belt-and-braces refusal rather than removing anyway, because the
    # cost of being wrong here is destroying another deployment's containers.
    if [ -z "$RECONCILE_AUTHORIZED" ]; then
        echo "  WARNING: '${svc}' is no longer declared but a container is still running:" >&2
        echo "    ${stale_ids}" >&2
        echo "    Not removing it - this deploy is not authorized to (see the preflight message)." >&2
        reconcile_failed=1
        continue
    fi

    echo "  Removing ${svc}: no longer declared in '${COMPOSE_FILE}', but left running by a previous deploy."
    # Unquoted on purpose - there may be several ids, and they are hex with no whitespace.
    #
    # The rm's own exit status is deliberately ignored: a container can vanish between the ps and
    # the rm - a window this loop itself opens - and that is the DESIRED end state, not a failure.
    # What matters is whether the container is gone, so the re-query below decides, not the rm.
    # shellcheck disable=SC2086
    docker rm -f $stale >/dev/null 2>&1 || true
    if ! remaining=$(docker ps -aq \
        --filter "label=com.docker.compose.project=${compose_project}" \
        --filter "label=com.docker.compose.service=${svc}" \
        --filter "label=com.docker.compose.oneoff=False" 2>/dev/null); then
        echo "  WARNING: could not confirm '${svc}' was removed." >&2
        reconcile_failed=1
    elif [ -n "$remaining" ]; then
        echo "  ERROR: '${svc}' container(s) still present after removal: $(printf '%s' "$remaining" | tr '\n' ' ')" >&2
        reconcile_failed=1
    fi
done <<<"$deployable_all"

echo ""

# A deploy that could not retire the services it was asked to drop has NOT applied the requested
# topology - the old service is still serving. Exiting 0 there would let automation keyed on the
# status record the slim topology as live while the fat one keeps running, which is the silent
# half-applied deploy this reconciliation exists to prevent. Reported after the restarts, so the
# services that DID deploy are up, but the run still fails.
if [ -n "$reconcile_failed" ]; then
    echo "" >&2
    echo "ERROR: the deployed services are up, but stale containers for dropped services could" >&2
    echo "  not be retired (see above). The running topology does not match '${COMPOSE_FILE}'." >&2
    exit 1
fi

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
# Advertise only endpoints this deployment actually serves. A server-only stack that
# printed "Local access: http://localhost:8080" would send the operator to a port nothing
# is listening on and read as a broken deploy rather than a correctly slimmed-down one.
if in_deployment ui; then
    echo "Local access:  http://localhost:8080"
fi
if in_deployment internal-service; then
    echo "WebSocket:     ws://localhost:${INTERNAL_SERVICE_PORT:-12345}"
fi
