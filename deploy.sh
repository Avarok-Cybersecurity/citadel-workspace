#!/usr/bin/env bash
# =============================================================================
# Citadel Workspace - Deploy / Update Script
# =============================================================================
#
# This script safely updates the running production stack:
#   1. Pulls latest code (skippable with --no-pull)
#   2. Pulls prebuilt images from GHCR at ${IMAGE_TAG:-latest}
#   3. Verifies every image was built from the SAME commit, and refuses
#      the deploy if they disagree (scripts/verify-image-revisions.sh)
#   4. Restarts services sequentially (data-safe, minimal downtime)
#
# Data volumes (server_data, internal_service_data) are NEVER touched.
# Only container images are replaced.
#
# verify: absent 'docker compose build' in-body deploy.sh
#
# NOTE: this header used to say "rebuilds only changed images". It no longer
# builds anything -- compiling Rust on the production host was removed
# deliberately (see the comment above the pull step). An operator trusting the
# old wording would provision a build toolchain this script never uses and
# expect a deploy far slower than it is.
#
# Usage:
#   ./deploy.sh              # Update all services to ${IMAGE_TAG:-latest}
#   ./deploy.sh --no-pull    # Skip the git pull; deploy the checked-out tree's compose file
#   ./deploy.sh --tunnel     # Include Cloudflare tunnel profile
#
#   IMAGE_TAG=sha-abc123456789 ./deploy.sh --no-pull   # pin / roll back to an exact build
#
# See docs/UPGRADING.md for the upgrade and rollback runbook.
#
# =============================================================================

set -euo pipefail

COMPOSE_FILE="docker-compose.production.yml"
# Bash array (not a string) so `${PROFILE_ARGS[@]+"${PROFILE_ARGS[@]}"}` expands to nothing
# when no profile is selected and to a properly quoted multi-token list
# when one is. Storing "--profile tunnel" as a single string and relying
# on word-splitting (`$PROFILE_ARGS` unquoted) is the classic shell
# gotcha that breaks the moment a value contains whitespace, glob chars,
# or a single empty element.
PROFILE_ARGS=()
TUNNEL_PROFILE_ACTIVE=false
SKIP_PULL=false

# One description of the interface, printed both on request and on a mistake, so
# the two can never drift apart.
usage() {
    cat <<USAGE
Citadel Workspace - deploy / update the running production stack.

Usage: $0 [--no-pull] [--tunnel] [--help]

  --no-pull   Skip the git pull; deploy using the compose file already checked out.
  --tunnel    Include the Cloudflare tunnel profile. Requires TUNNEL_TOKEN in .env.
  --help, -h  Print this and exit.

Images are PULLED from GHCR at \${IMAGE_TAG:-latest}; nothing is built here.
Pin IMAGE_TAG to a sha-<12-char> tag to deploy or roll back to an exact build:

  IMAGE_TAG=sha-abc123456789 $0 --no-pull

Data volumes (server_data, internal_service_data) are never touched; only
container images are replaced. See docs/UPGRADING.md.
USAGE
}

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
        --help|-h)
            # Asking what a deploy script does should not be an error, and should
            # not exit non-zero — a wrapper checking the status would read that as
            # a failed deploy.
            usage
            exit 0
            ;;
        *)
            echo "Unknown argument: $arg" >&2
            usage >&2
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

# Same reasoning for the origin allowlist, which became a second required value
# when the internal service stopped accepting a default. The service refuses to
# start without it — correctly, since any default is either wrong for every real
# deployment or is the hole itself — but that refusal arrives after the images
# are built. Catch it here instead.
# Either source, because that is how compose resolves `${VAR}`: the environment
# first, then .env. Reading only the file rejected a correctly-configured deploy
# that exports the value in the shell — which is exactly what
# scripts/test-deploy-services.sh does, and how this check first failed.
origins="${INTERNAL_SERVICE_ALLOWED_ORIGINS:-}"
if [[ -z "$origins" ]]; then
    origins=$(grep -E '^[[:space:]]*INTERNAL_SERVICE_ALLOWED_ORIGINS=' .env | tail -n1 | cut -d= -f2-)
fi
origins="${origins%$'\r'}"
origins="${origins#"${origins%%[![:space:]]*}"}"
origins="${origins%"${origins##*[![:space:]]}"}"
if [[ -z "$origins" ]]; then
    echo "ERROR: INTERNAL_SERVICE_ALLOWED_ORIGINS is unset or empty."
    echo "  Set it to the origin(s) that may drive the internal service, e.g.:"
    echo "    INTERNAL_SERVICE_ALLOWED_ORIGINS=https://yourdomain.com"
    echo "  Any page allowed here can enumerate every account and act as them."
    exit 1
fi
if [[ "$origins" == *"*"* ]]; then
    echo "WARNING: INTERNAL_SERVICE_ALLOWED_ORIGINS contains '*'. Any page the user"
    echo "  visits can drive this agent. This is for local experiments, not deployments."
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

# flock serializes deploys of the same compose project (see the lock below). Checked here rather
# than tolerated, because a deploy that silently skipped the lock would silently reintroduce the
# interleaving the lock exists to stop - and there is nothing to weigh against that, since flock
# ships with util-linux and is present on every Linux host this deploys to.
if ! command -v flock >/dev/null 2>&1; then
    echo "ERROR: 'flock' is required to serialize deploys. Install with:"
    echo "  apt-get install util-linux   # Debian/Ubuntu"
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

# Serialize runs from THIS CHECKOUT, before anything reads or writes it.
#
# The project lock further down cannot cover this. It is keyed on the compose project name, which
# is only knowable by reading the compose file - so by the time it can be taken, `git pull` has
# already run and the service selection has already read that file. A second run started from the
# same directory would pull new code into the checkout underneath the first, which then goes on to
# re-read the compose file for `pull`, `up -d` and `ps`: it would verify one revision and restart
# another. Refusing the second run only after its git step is too late; the damage is done there.
#
# So this lock is taken first and covers the whole run, git step included. It is keyed on the one
# thing already known before any file is read: the checkout itself. That is the working directory,
# which is what every relative path in this script - `docker-compose.production.yml`,
# `./scripts/...` - already resolves against, so it is exactly the resource at risk. Locking the
# DIRECTORY's inode rather than a path-derived name means the identity is exact: no hashing, no
# name collisions between checkouts, no path-length limit, and two runs from the same directory
# necessarily open the same inode. The lock is advisory and only this script takes it, so it does
# not interfere with git's own locking.
#
# Both locks are taken in this order, checkout then project, and both are non-blocking, so they
# cannot deadlock: a run that cannot get the second lock exits and drops the first.
checkout_dir="$PWD"
if ! exec 8<"$checkout_dir"; then
    echo "ERROR: could not open '${checkout_dir}' to lock this checkout." >&2
    exit 1
fi
if ! flock -n 8; then
    echo "ERROR: another deploy is already running from this checkout (${checkout_dir})." >&2
    echo "  Wait for it to finish, then re-run. Nothing has been changed." >&2
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
# Read into the array with a while-read loop rather than `mapfile -t`. mapfile is a
# bash 4 builtin and macOS still ships bash 3.2, so `#!/usr/bin/env bash` there
# resolves to a shell without it and the deploy aborted at this line with
# "mapfile: command not found" (exit 127) — before touching anything, but also
# before doing anything. CI runs Ubuntu, so this only ever failed for a developer
# deploying from a Mac. The loop below is equivalent and works on both.
DEPLOY_SERVICES=()
while IFS= read -r _svc; do
    [ -n "$_svc" ] && DEPLOY_SERVICES+=("$_svc")
done <<<"$selection"
# Belt and braces: the selector already errors on an empty result, and the check above now
# actually observes that, but a silent empty selection must never fall through to a restart.
if [ "${#DEPLOY_SERVICES[@]}" -eq 0 ] || [ -z "${DEPLOY_SERVICES[0]}" ]; then
    echo "ERROR: no deployable services selected from '$COMPOSE_FILE'." >&2
    exit 1
fi
echo "  Services in this deployment: ${DEPLOY_SERVICES[*]}"

# A service this compose file DROPS, whose container is still running, has to be dealt with before
# the deploy can honestly claim to have applied it.
#
# `docker compose up` does not remove containers for services the file no longer declares - it
# warns about "orphan containers" and leaves them running (verified). Guarding the restart above
# without noticing that would turn one failure into a worse one: before this change a slimmed
# deploy died at `up -d --no-deps ui` with "no such service", loudly; now it would succeed while
# the old ui kept serving stale code on :8080, silently. A silent half-applied deploy is the one
# outcome this script's ordering exists to prevent.
#
# So it REFUSES, here, before anything is pulled or restarted - the running stack is left exactly
# as it was - and prints the command to clear the leftovers.
#
# Deliberately not `docker rm -f` on the operator's behalf, even though a lock is taken below.
# These are two different jobs with two different bars. That lock SERIALIZES: it gates nothing
# destructive, so an account that never contends for it is left exactly where this script already
# was. Removing containers would make the lock AUTHORIZE destruction, and matching by the
# com.docker.compose.project label reaches every checkout and account on the daemon - so it would
# have to prove no other deploy is mid-flight anywhere on the host, which the per-account lock
# below does not and cannot. That is a far larger mechanism, and a destructive one, for a
# transition that happens rarely and takes one command by hand.
if ! deployable_all=$(./scripts/select-deploy-services.sh --deployable); then
    exit 1
fi
preflight_project=$(docker compose -f "$COMPOSE_FILE" config --format json | jq -r '.name // empty')
if [ -z "$preflight_project" ]; then
    echo "ERROR: could not read the compose project name from '$COMPOSE_FILE'." >&2
    exit 1
fi

# Serialize deploys of this compose project, for the whole run.
#
# The check below is a point-in-time snapshot, and everything it protects happens afterwards. A
# second deploy of the same project - typically the same operator from a different checkout, or a
# rerun fired before the first finished - can start a `ui` container between the check and the
# restarts, and this run would then report "Deploy complete" over a topology it never verified.
#
# The lock is taken BEFORE the check and held to the end of the script, so the snapshot stays true
# for as long as anything depends on it - against every deploy that takes this same lock, which is
# the precise limit of the guarantee; see the scoping note below for who that leaves out. `exec 9>`
# keeps the descriptor open for the process lifetime and the kernel drops the lock when the process
# exits, so there is no unlock path to get wrong and no trap to misfire - and the file is
# deliberately never removed, since unlinking a lock other deploys may already hold reintroduces
# the race it exists to close.
#
# Scoped to the account, under a directory it owns, so it needs no provisioning and cannot be
# squatted in a shared world-writable directory. The cost is that the scope is narrower than the
# thing being protected: containers and project labels live on the shared daemon, and the stale
# check matches by project label across every account on it, so two accounts deploying the same
# project take different lock files and do NOT serialize. Closing that needs a lock file both
# accounts can open, which means an administrator provisioning it with ownership and permissions
# that stop either account replacing it - a deployment-provisioning change, deliberately not made
# here. What keeps it out of blocking territory is that nothing acts on this lock's authority: it
# gates no removal and no destructive step, so an unshared lock costs the missed refusal described
# above - exactly where this script already was - and never a destructive action.
#
# Keyed off HOME alone, deliberately - NOT $XDG_RUNTIME_DIR. Two deploys serialize only if they
# pick the same file, and XDG_RUNTIME_DIR is set inside a login session and absent from cron or a
# bare ssh command, so honouring it would hand the same operator two different locks depending on
# how the deploy was started, which is precisely when the two runs must contend.
lock_dir="${HOME:?HOME must be set to locate the deploy lock}/.cache/citadel-deploy"
if ! mkdir -p -m 700 "$lock_dir" 2>/dev/null; then
    echo "ERROR: could not create the deploy lock directory '${lock_dir}'." >&2
    exit 1
fi
lock_file="${lock_dir}/${preflight_project}.lock"
if ! exec 9>"$lock_file"; then
    echo "ERROR: could not open the deploy lock '${lock_file}'." >&2
    exit 1
fi
if ! flock -n 9; then
    echo "ERROR: another deploy of project '${preflight_project}' is already running." >&2
    echo "  It holds ${lock_file}. Wait for it to finish, then re-run." >&2
    echo "  Nothing has been changed." >&2
    exit 1
fi

stale_report=""
while read -r svc; do
    [ -n "$svc" ] || continue
    printf '%s\n' "${DEPLOY_SERVICES[@]}" | grep -qx "$svc" && continue
    # oneoff=False excludes `docker compose run` containers, which carry the same project and
    # service labels: a migration or debugging job is not a stale service.
    if ! found=$(docker ps -aq \
        --filter "label=com.docker.compose.project=${preflight_project}" \
        --filter "label=com.docker.compose.service=${svc}" \
        --filter "label=com.docker.compose.oneoff=False" 2>/dev/null); then
        echo "ERROR: cannot list containers for the dropped service '${svc}'." >&2
        echo "  Refusing to deploy rather than guess; nothing has been changed." >&2
        exit 1
    fi

    # A leftover is a hazard if it serves now, or if it will serve again without anyone asking.
    # Anything else is inert and must NOT block the deploy: hosts that once ran the full stack
    # accumulate dead containers, and refusing over those would fail the documented slim deploy on
    # exactly the hosts it is for, telling the operator to force-remove something already harmless.
    #
    # Serving now is `running`, plus `paused` (frozen, but still holding its published ports) and
    # `restarting` (crash-looping back into service).
    #
    # Serving again is decided by the restart policy, and ONLY `always` qualifies. That is the sole
    # difference between `always` and `unless-stopped`: both bring a crashed container back while
    # the daemon runs, but a container stopped by hand stays stopped under `unless-stopped` and is
    # started again under `always` the next time the daemon does - so an exited `always` container
    # for a dropped service is a stale service waiting on the next host reboot. `no` never returns,
    # and `on-failure` has either exited clean, where the policy does not apply, or exhausted its
    # retries while the daemon was up.
    while read -r cid; do
        [ -n "$cid" ] || continue
        if ! info=$(docker inspect -f '{{.State.Status}} {{.HostConfig.RestartPolicy.Name}}' "$cid" 2>/dev/null); then
            # Judge by outcome: a container that vanished between the list and the inspect is the
            # state we wanted anyway. Anything still there that we cannot read, we refuse on.
            #
            # The re-query's SUCCESS is checked separately from its RESULT, and the difference is
            # the whole point. `docker ps ... | grep -q .` collapses the two: it is equally false
            # when the container is gone and when the query itself failed - and a failing query is
            # the LIKELY case here, since whatever stopped `docker inspect` from answering
            # (daemon down, API error) will usually stop this one too. Skipping on that reading
            # would fail open on the one path written to fail closed.
            if ! remaining=$(docker ps -aq --filter "id=${cid}" 2>/dev/null); then
                echo "ERROR: cannot inspect container ${cid} of the dropped service '${svc}'," >&2
                echo "  and cannot confirm whether it is still there. Nothing has been changed." >&2
                exit 1
            fi
            if [ -n "$remaining" ]; then
                echo "ERROR: cannot inspect container ${cid} of the dropped service '${svc}'." >&2
                echo "  Refusing to deploy rather than guess; nothing has been changed." >&2
                exit 1
            fi
            continue
        fi
        read -r cstatus cpolicy <<<"$info"
        case "$cstatus" in
            running|paused|restarting) reason="$cstatus" ;;
            *) [ "$cpolicy" = "always" ] && reason="restarts on reboot" || continue ;;
        esac
        stale_report="${stale_report}${svc}|${reason}|${cid}"$'\n'
    done <<<"$found"
done <<<"$deployable_all"

if [ -n "$stale_report" ]; then
    echo "ERROR: '${COMPOSE_FILE}' no longer declares these services, but they are still on this host:" >&2
    while IFS='|' read -r svc reason cid; do
        [ -n "$svc" ] || continue
        echo "    ${svc}: ${cid} (${reason})" >&2
    done <<<"$stale_report"
    echo "" >&2
    echo "  Deploying now would restart the services this file DOES declare while those kept" >&2
    echo "  serving their old images - a deployment that matches neither the old topology nor the" >&2
    echo "  new one. A container marked 'restarts on reboot' is not serving yet, but its" >&2
    echo "  restart: always policy will start it again the next time the Docker daemon does." >&2
    echo "  Nothing has been changed." >&2
    echo "" >&2
    echo "  Remove them, then re-run:" >&2
    # `if`, not `[ -n ... ] &&`: the trailing blank line makes the test fail, which would be the
    # loop's - and so the substitution's - exit status, and `set -e` would kill the script here.
    stale_ids=$(while IFS='|' read -r _ _ cid; do
        if [ -n "$cid" ]; then printf '%s ' "$cid"; fi
    done <<<"$stale_report")
    echo "    docker rm -f ${stale_ids% }" >&2
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

if ! docker compose -f "$COMPOSE_FILE" ${PROFILE_ARGS[@]+"${PROFILE_ARGS[@]}"} pull "${DEPLOY_SERVICES[@]}"; then
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

# Also require the images to be built from the commit we just pulled.
#
# Cross-checking the images against each other proves they were promoted
# together, not WHICH commit they are: `git pull` and `docker compose pull` are
# independent. On the ordinary merge-then-deploy workflow, CI is often still
# building the Rust images, so `latest` still points at the previous commit —
# all three images agree, the gate passes, every service restarts, and "Deploy
# complete!" prints over the old binaries with the new source beside them.
#
# Only when we pulled: with --no-pull the checked-out tree is whatever the
# operator chose, and an explicit IMAGE_TAG rollback deliberately deploys an
# older commit than HEAD.
EXPECT_ARGS=()
if [ "$SKIP_PULL" != "true" ] && [ -z "${IMAGE_TAG:-}" ]; then
    head_rev=$(git rev-parse HEAD 2>/dev/null || true)
    [ -n "$head_rev" ] && EXPECT_ARGS=(--expect "$head_rev")
fi

if ! ./scripts/verify-image-revisions.sh "${EXPECT_ARGS[@]+"${EXPECT_ARGS[@]}"}" "${VERIFY_IMAGES[@]}"; then
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
    echo
    # Services are swapped one at a time, gated on health. A failure here means
    # THIS service is on the new image and the ones after it are still on the
    # old one — the mixed-version state the ordering exists to avoid on a
    # build/pull failure, but which a STARTUP failure lands in anyway. Say so,
    # rather than leaving an exit 1 that reads like "nothing happened".
    echo "The stack is now MIXED-VERSION: ${svc} is on the new image, later services are not."
    rollback_hint "${PREVIOUS_TAGS:-}"
    exit 1
}

# Record what is running BEFORE anything is swapped.
#
# Rolling back needs the tag you were on, and nothing recorded it. The docs said
# to "list the published versions under the org's GHCR packages" — no URL, no
# command, in a runbook where every other step is copy-pasteable — and the tag
# is otherwise printed once into an Actions log subject to 90-day retention.
# An operator mid-incident should not be archaeologising a registry.
DEPLOY_HISTORY="${DEPLOY_HISTORY:-$HOME/.cache/citadel-deploy/history}"
mkdir -p "$(dirname "$DEPLOY_HISTORY")"

previous_images() {
    # `|| true` because finding nothing is the NORMAL first-deploy answer, and
    # `set -o pipefail` makes grep's exit 1 the whole pipeline's — which under
    # `set -e` aborted the script at the assignment below. A machine with
    # nothing deployed yet printed "[3/4] Updating services", exited 1, and
    # restarted nothing, AFTER pulling every image: the one path with no
    # previous version to roll back to was the one path that could not run.
    docker compose -f "$COMPOSE_FILE" images --format json 2>/dev/null \
        | tr ',' '\n' | grep -o '"Tag":"[^"]*"' | cut -d'"' -f4 | sort -u | tr '\n' ' ' \
        || true
}
PREVIOUS_TAGS="$(previous_images)"
# An `if`, not `[ -n … ] && echo`.
#
# Under `set -e` that form aborts the script whenever the test is false, because
# the && chain's exit status becomes the statement's. So a deploy with nothing
# currently running -- the FIRST deploy on a machine, and every deploy in the
# integration test's stub environment -- printed "[3/4] Updating services" and
# exited 1, after the images had already been pulled. A failure on the one path
# that has no previous version to roll back to.
if [ -n "$PREVIOUS_TAGS" ]; then
    echo "  Currently deployed tag(s): ${PREVIOUS_TAGS}"
fi

# Named so the failure path can tell the operator exactly what to type.
rollback_hint() {
    local tags="$1"
    local first
    first="$(echo "$tags" | awk '{print $1}')"
    if [ -n "$first" ] && [ "$first" != "latest" ]; then
        echo "  Roll back with:  IMAGE_TAG=${first} $0"
    else
        echo "  Roll back with:  IMAGE_TAG=sha-<previous-commit> $0"
        echo "  Previous tags seen on this host: ${DEPLOY_HISTORY}"
    fi
}

# Server first (other services depend on it).
#
# No `--build`: the image was pulled in step 2. Leaving `--build` here would
# silently re-compile on the host and defeat the whole point of the registry.
echo "  Restarting server..."
docker compose -f "$COMPOSE_FILE" ${PROFILE_ARGS[@]+"${PROFILE_ARGS[@]}"} up -d --no-deps server
echo "  Waiting for server to be healthy..."
wait_for_port server 12349
echo "  Server is up."

# Internal service next, when this deployment includes one.
if in_deployment internal-service; then
    echo "  Restarting internal-service..."
    docker compose -f "$COMPOSE_FILE" ${PROFILE_ARGS[@]+"${PROFILE_ARGS[@]}"} up -d --no-deps internal-service
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
    docker compose -f "$COMPOSE_FILE" ${PROFILE_ARGS[@]+"${PROFILE_ARGS[@]}"} up -d --no-deps ui
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
    docker compose -f "$COMPOSE_FILE" ${PROFILE_ARGS[@]+"${PROFILE_ARGS[@]}"} up -d --no-deps cloudflared
    echo "  Cloudflared is up."
fi

echo ""

# Step 4: Verify
echo "[4/4] Verifying deployment..."
docker compose -f "$COMPOSE_FILE" ${PROFILE_ARGS[@]+"${PROFILE_ARGS[@]}"} ps
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

# Append what we just deployed, so the NEXT deploy has a previous tag to name
# and an operator has a local record that does not depend on registry retention
# or a 90-day Actions log.
{
    printf '%s\t%s\t%s\n' \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        "${IMAGE_TAG:-latest}" \
        "$(previous_images)"
} >> "$DEPLOY_HISTORY" 2>/dev/null || true
echo "Recorded in ${DEPLOY_HISTORY}"
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
