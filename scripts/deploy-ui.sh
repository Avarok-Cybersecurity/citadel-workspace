#!/usr/bin/env bash
#
# Deploy ONLY the UI container, by tag.
#
# Why this exists
# ---------------
# On avarok2 the UI is not under Compose: `docker compose config --services`
# lists `server` alone, and `citadel-ui` is a container somebody started by
# hand. Its settings existed nowhere in this repository until they were
# recovered with `docker inspect` (see docs/PRODUCTION_DEPLOYMENT.md). A
# deployment whose configuration lives only in a running container is one
# `docker rm` away from being lost, and nobody can review it.
#
# It is not under Compose for two reasons, both real:
#
#   1. All three services in docker-compose.production.yml share one
#      ${IMAGE_TAG}. Deploying a UI-only fix through Compose would carry the
#      server forward with it -- ~140 commits, to ship a change to a bundle.
#   2. That file's `ui` service declares
#          depends_on: { internal-service: service_healthy, server: ... }
#      and the hosted stack runs neither of those next to the UI. A hosted UI
#      backed by a SHARED agent is incompatible with the threat model -- that
#      agent would hold every user's ratchet keys -- which is exactly why
#      WS_PROXY_ENABLED=0 below and why each visitor runs their own.
#
# So the UI is deployed on its own, and this script is that act, written down.
set -euo pipefail

TAG="${1:-}"
UI_PORT="${UI_PORT:-8099}"
LOOPBACK_AGENT_ORIGIN="${LOOPBACK_AGENT_ORIGIN:-}"
DEFAULT_WORKSPACE_SERVER="${DEFAULT_WORKSPACE_SERVER:-}"
IMAGE="ghcr.io/avarok-cybersecurity/citadel-workspace-ui"
NAME="${UI_CONTAINER_NAME:-citadel-ui}"

if [ -z "$TAG" ]; then
  echo "usage: LOOPBACK_AGENT_ORIGIN=wss://local.example.com:12345 $0 <image-tag>" >&2
  echo "       e.g. $0 sha-81435e19c0be" >&2
  exit 2
fi

# No default. An empty origin ships a page that loads, looks correct, and can
# open a socket to nothing: the meta tag is blank and `connect-src 'self'`
# forbids the agent. That is a deploy-time outage, not a configuration.
if [ -z "$LOOPBACK_AGENT_ORIGIN" ]; then
  echo "ERROR: LOOPBACK_AGENT_ORIGIN is empty." >&2
  echo "  A hosted page reaches the visitor's OWN agent by name. Set it to the" >&2
  echo "  wss:// origin you published and hold a certificate for." >&2
  exit 1
fi

# Same shape the page and the image's own validator require: lowercase host,
# explicit port, no path. Checked here too so a typo fails before the running
# container is destroyed, not after.
if ! printf '%s' "$LOOPBACK_AGENT_ORIGIN" | grep -Eq '^wss://[a-z0-9]([a-z0-9.-]*[a-z0-9])?:[0-9]{1,5}$'; then
  echo "ERROR: LOOPBACK_AGENT_ORIGIN must look like wss://local.example.com:12345" >&2
  echo "  got: $LOOPBACK_AGENT_ORIGIN" >&2
  exit 1
fi

# Optional, unlike the origin above: empty means the join wizard asks for the
# address, which is correct for a deployment that has not published one. But a
# value that is set and malformed is worse than none -- the page's reader
# refuses it, so the field renders empty and the operator sees the feature
# simply not working, with nothing anywhere saying why. Fail here instead.
if [ -n "$DEFAULT_WORKSPACE_SERVER" ] &&
   ! printf '%s' "$DEFAULT_WORKSPACE_SERVER" | grep -Eq '^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?:[0-9]{1,5}$'; then
  echo "ERROR: DEFAULT_WORKSPACE_SERVER must be host:port, e.g. citadel.example.com:12400" >&2
  echo "  got: $DEFAULT_WORKSPACE_SERVER" >&2
  echo "  (leave it unset to have the join wizard ask instead)" >&2
  exit 1
fi

# 127.0.0.1, always. Host nginx terminates TLS and proxies to this port; a
# wildcard bind would publish the UI -- and the /ws route behind it -- to the
# whole network. See docs/ROBUSTNESS.md [agent-is-loopback-only].
PUBLISH="127.0.0.1:${UI_PORT}:8080"

# GHCR packages here are PRIVATE, and the host holds no registry credentials.
# Rather than store a GitHub token on a public-facing server, an image can be
# side-loaded (`docker save` on an authenticated machine, `docker load` here)
# and this run told so EXPLICITLY.
#
# Explicit, not a fallback: "pull failed, use whatever is cached" would silently
# redeploy a stale image on any transient registry error, which is precisely the
# failure this script's pull-before-remove ordering exists to avoid. With
# ALLOW_PRELOADED unset, a failed pull is still fatal and the running container
# is untouched.
echo "Pulling ${IMAGE}:${TAG}"
if ! docker pull "${IMAGE}:${TAG}"; then
  if [ "${ALLOW_PRELOADED:-}" = "1" ] && docker image inspect "${IMAGE}:${TAG}" >/dev/null 2>&1; then
    echo "  pull failed; using the preloaded image (ALLOW_PRELOADED=1)"
    docker image inspect "${IMAGE}:${TAG}" --format "  loaded {{.Id}} created {{.Created}}"
  else
    echo "ERROR: could not pull ${IMAGE}:${TAG} and no preloaded image was authorised." >&2
    echo "  Either authenticate this host to the registry, or side-load the image" >&2
    echo "  and re-run with ALLOW_PRELOADED=1." >&2
    exit 1
  fi
fi

# Pull BEFORE removing: a failed pull must not leave the site down.
echo "Replacing ${NAME}"
docker rm -f "${NAME}" >/dev/null 2>&1 || true

docker run -d --name "${NAME}" --restart unless-stopped \
  -p "${PUBLISH}" \
  -e "LOOPBACK_AGENT_ORIGIN=${LOOPBACK_AGENT_ORIGIN}" \
  -e "DEFAULT_WORKSPACE_SERVER=${DEFAULT_WORKSPACE_SERVER}" \
  -e WS_PROXY_ENABLED=0 \
  -e AGENT_UPSTREAM=127.0.0.1:12345 \
  -e LISTEN_ADDR=0.0.0.0 \
  "${IMAGE}:${TAG}"

echo "Waiting for it to serve..."
for _ in $(seq 1 30); do
  if curl -fsS -o /dev/null "http://127.0.0.1:${UI_PORT}/"; then
    echo "  serving on 127.0.0.1:${UI_PORT}"
    # Assert what the deploy is FOR, not merely that nginx answers: the policy
    # and the meta tag are what let a visitor's browser reach their own agent.
    csp="$(curl -fsS -D- -o /dev/null "http://127.0.0.1:${UI_PORT}/" | tr -d '\r' | grep -i '^content-security-policy:' || true)"
    meta="$(curl -fsS "http://127.0.0.1:${UI_PORT}/" | grep -o 'name="citadel-loopback-agent" content="[^"]*"' || true)"
    case "$csp" in
      *"$LOOPBACK_AGENT_ORIGIN"*) echo "  CSP names the agent origin" ;;
      *) echo "ERROR: the CSP does not name ${LOOPBACK_AGENT_ORIGIN}" >&2; exit 1 ;;
    esac
    case "$meta" in
      *"$LOOPBACK_AGENT_ORIGIN"*) echo "  meta tag names the agent origin" ;;
      *) echo "ERROR: the loopback meta tag was not injected (got: ${meta:-none})" >&2; exit 1 ;;
    esac
    echo "Deployed ${IMAGE}:${TAG}"
    exit 0
  fi
  sleep 2
done

echo "ERROR: ${NAME} did not serve on 127.0.0.1:${UI_PORT} within 60s." >&2
docker logs --tail 40 "${NAME}" >&2 || true
exit 1
