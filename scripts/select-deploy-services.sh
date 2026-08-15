#!/usr/bin/env bash
#
# Print which of the deployable services a compose file actually declares, one per line,
# in deploy order (server first).
#
# WHY THIS IS A SEPARATE SCRIPT
#
# This selection decides what gets pulled, what gets revision-checked, and what gets
# restarted. Get it wrong in either direction and you get a half-applied deploy:
#
#   * too few  -> a declared service is silently skipped. No pull, no restart, no health
#                 wait, and the run still prints "Deploy complete" while the old container
#                 keeps serving old code. Silent, and far harder to notice than a crash.
#   * too many -> `up -d` on a service that was never pulled, i.e. restarting onto a stale
#                 or missing image, mid-deploy.
#
# deploy.sh already makes this argument about the release-consistency gate and moved it to
# scripts/verify-image-revisions.sh for exactly this reason: a safety-critical decision
# wedged between an image pull and a production restart cannot be tested where it sits.
# Same reasoning, same treatment - as a standalone script taking a compose file, it is
# exercised directly in CI (validate.yml -> deploy-gate-tests) against real compose files.
#
# THE INVARIANT THIS EXISTS TO HOLD
#
# The set printed here is used for pull, revision-check AND restart. They must be the same
# set: you restart exactly what you pulled and verified. Do not reintroduce a second,
# independent "is this declared?" test elsewhere in the deploy - two sources of truth for
# the same question is precisely how the too-many case above gets in.
#
# `server` is required; its absence is an error rather than an empty result, because
# "nothing to deploy" should never be reported as a successful no-op deploy.
#
# Usage:  select-deploy-services.sh <compose-file>
# Exit 0: prints one service per line.  Exit 1: no server service, message on stderr.

set -euo pipefail

COMPOSE_FILE="${1:?usage: select-deploy-services.sh <compose-file>}"

# The services this project knows how to deploy, in restart order. `cloudflared` is
# deliberately absent: it is profile-gated and handled separately by deploy.sh's
# TUNNEL_PROFILE_ACTIVE branch, not by this selection.
DEPLOYABLE=(server internal-service ui)

declared=$(docker compose -f "$COMPOSE_FILE" config --services)

selected=()
for svc in "${DEPLOYABLE[@]}"; do
    if printf '%s\n' "$declared" | grep -qx "$svc"; then
        selected+=("$svc")
    fi
done

if ! printf '%s\n' "${selected[@]:-}" | grep -qx server; then
    echo "ERROR: '$COMPOSE_FILE' declares no 'server' service; there is nothing to deploy." >&2
    exit 1
fi

printf '%s\n' "${selected[@]}"
