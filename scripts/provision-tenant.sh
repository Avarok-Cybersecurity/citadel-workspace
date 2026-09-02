#!/usr/bin/env bash
# =============================================================================
# Provision one tenant of the Citadel Workspace stack.
# =============================================================================
#
# deploy.sh UPDATES a stack that already exists. It refuses to run without a
# populated .env, and says so. This is the step before it: create the tenant
# directory, generate its master password, allocate its ports, and write the
# ingress config -- so that onboarding is a command rather than a runbook.
#
# WHY A TENANT IS A WHOLE SERVER INSTANCE
#
# `WORKSPACE_ROOT_ID` is the constant "workspace-root", used in 92 places in
# citadel-workspace-server-kernel. One server process owns exactly one root
# workspace, and WORKSPACE_MASTER_PASSWORD is the operator credential that
# claims it -- "first user with master password becomes admin". Two tenants
# sharing a server would therefore share a root workspace and its admin, which
# is not multi-tenancy. So the unit of provisioning is a server instance:
# its own compose project, data volumes, ports and password.
#
# FUTURE INTENT, recorded here because the constant does not say it: supporting
# several workspaces per server means giving the root a tenant-scoped id rather
# than a constant, and threading that id through the 92 call sites and the
# backend key space. Nothing here forecloses that -- a tenant would simply stop
# being one-to-one with a server process.
#
# WHAT THIS DELIBERATELY DOES NOT HOST
#
# `--topology full` runs the agent (internal-service) alongside the server. The
# agent is the P2P ratchet ENDPOINT, not a relay: peer_channel_created.rs takes
# already-decrypted messages off the stream and forwards the plaintext to the
# browser. Running it for OTHER people puts their P2P plaintext on this host.
# Hosting the workspace server has no such property -- it sees only C2S traffic,
# under a bundle distinct from any peer-to-peer one. So `server-only` is the
# default, and `full` is for a host whose agent serves its own operator.
#
# Usage:
#   ./scripts/provision-tenant.sh --tenant acme [options]
#
#   --tenant NAME        Required. [a-z0-9-], becomes the compose project name.
#   --ingress MODE       nginx | tunnel | none   (default: none)
#   --topology MODE      server-only | full      (default: server-only)
#   --domain FQDN        Required unless --ingress none.
#   --base-port N        First port of this tenant's block (default: auto).
#   --root DIR           Where tenants live (default: /srv/citadel-tenants).
#   --dry-run            Print what would be written; touch nothing.
#   --force              Overwrite an existing tenant directory.
# =============================================================================
set -euo pipefail

TENANT="" ; INGRESS="none" ; TOPOLOGY="server-only" ; DOMAIN=""
BASE_PORT="" ; ROOT="/srv/citadel-tenants" ; DRY_RUN=false ; FORCE=false

die() { echo "ERROR: $*" >&2; exit 1; }
usage() { sed -n '/^# Usage:/,/^# ===/p' "$0" | sed 's/^# \{0,1\}//'; }

while [ $# -gt 0 ]; do
  case "$1" in
    --tenant)    TENANT="${2:?--tenant needs a value}"; shift 2 ;;
    --ingress)   INGRESS="${2:?--ingress needs a value}"; shift 2 ;;
    --topology)  TOPOLOGY="${2:?--topology needs a value}"; shift 2 ;;
    --domain)    DOMAIN="${2:?--domain needs a value}"; shift 2 ;;
    --base-port) BASE_PORT="${2:?--base-port needs a value}"; shift 2 ;;
    --root)      ROOT="${2:?--root needs a value}"; shift 2 ;;
    --dry-run)   DRY_RUN=true; shift ;;
    --force)     FORCE=true; shift ;;
    --help|-h)   usage; exit 0 ;;
    *)           usage >&2; die "unknown argument: $1" ;;
  esac
done

[ -n "$TENANT" ] || { usage >&2; die "--tenant is required"; }
# The name becomes a compose project, a directory and a volume prefix. Anything
# outside this set would either be rejected downstream or, worse, traverse.
[[ "$TENANT" =~ ^[a-z0-9][a-z0-9-]{0,30}$ ]] || die "--tenant must match [a-z0-9][a-z0-9-]{0,30}"
case "$INGRESS" in nginx|tunnel|none) ;; *) die "--ingress must be nginx, tunnel or none" ;; esac
case "$TOPOLOGY" in server-only|full) ;; *) die "--topology must be server-only or full" ;; esac
if [ "$INGRESS" != "none" ] && [ -z "$DOMAIN" ]; then
  die "--domain is required when --ingress is $INGRESS"
fi
# Ingress serves the UI. Without the UI there is nothing for it to point at, and
# pointing it at the agent instead is the exact mistake the compose file's
# capitalised warning exists to prevent.
if [ "$INGRESS" != "none" ] && [ "$TOPOLOGY" = "server-only" ]; then
  die "--ingress $INGRESS needs --topology full: a server-only tenant serves no UI to route to"
fi

# --- port allocation ---------------------------------------------------------
# A tenant owns a contiguous block of 10: +0 server, +1 agent, +2 UI. The block
# is spaced so adding a fourth service later does not collide with the next
# tenant. Ports are checked against what is actually listening, not against a
# registry file that can drift from reality.
# A port check that cannot see is worse than none: it reports every port free
# and hands out one already in use. `ss` is Linux-only, so pick a tool that
# exists and REFUSE if none does, rather than silently approving everything.
# Caught by a control: --base-port 443 was accepted on a host without `ss`.
if command -v ss >/dev/null 2>&1; then
  port_busy() { ss -tlnH 2>/dev/null | awk '{print $4}' | grep -qE "[:.]$1\$"; }
elif command -v lsof >/dev/null 2>&1; then
  port_busy() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }
elif command -v netstat >/dev/null 2>&1; then
  port_busy() { netstat -an 2>/dev/null | grep -E "^tcp.*[:.]$1[[:space:]].*LISTEN" -q; }
else
  port_busy() { die "no ss, lsof or netstat: cannot tell whether port $1 is free"; }
fi

if [ -z "$BASE_PORT" ]; then
  for candidate in $(seq 12400 10 12990); do
    if ! port_busy "$candidate" && ! port_busy $((candidate+1)) && ! port_busy $((candidate+2)); then
      BASE_PORT="$candidate"; break
    fi
  done
  [ -n "$BASE_PORT" ] || die "no free 3-port block between 12400 and 12990"
fi
SERVER_PORT="$BASE_PORT"; AGENT_PORT=$((BASE_PORT+1)); UI_PORT=$((BASE_PORT+2))

for p in "$SERVER_PORT" "$AGENT_PORT" "$UI_PORT"; do
  port_busy "$p" && die "port $p is already in use; pass --base-port to choose another block"
done

TENANT_DIR="$ROOT/$TENANT"
if [ -e "$TENANT_DIR" ] && [ "$FORCE" != true ]; then
  die "$TENANT_DIR already exists. Re-provisioning destroys its .env (and with it the
  master password that its stored root-workspace password must match). Pass --force
  only if you intend that, and expect the kernel to ROTATE -- anyone holding the old
  password loses access."
fi

# --- the values --------------------------------------------------------------
# openssl, not $RANDOM: the latter is seeded from pid+time and is not a CSPRNG.
MASTER_PASSWORD="$(openssl rand -hex 32)"

if [ "$TOPOLOGY" = "full" ]; then
  # Both spellings: a proxy may present either, and the binary refuses to start
  # on an empty value rather than accepting every page on the internet.
  ORIGINS="https://$DOMAIN"
  [ "$INGRESS" = "none" ] && ORIGINS="http://localhost:$UI_PORT,http://127.0.0.1:$UI_PORT"
else
  ORIGINS=""
fi

# The WORKSPACE SERVER binds publicly so each user's own agent can dial in. That
# is the supported topology and the protocol is E2E encrypted between client and
# server.
BIND_ADDR="0.0.0.0:$SERVER_PORT"

# The AGENT IS LOOPBACK ONLY, always, in every topology. It is the P2P ratchet
# ENDPOINT -- peer_channel_created.rs forwards already-decrypted plaintext to the
# browser -- and its WebSocket is an unauthenticated control plane that an Origin
# check cannot defend (no CORS preflight; a non-browser client forges the header).
# So this is written as a constant, never derived from an argument, and asserted
# below so a future edit that parameterises it fails here instead of in production.
AGENT_BIND_HOST="127.0.0.1"
[ "$AGENT_BIND_HOST" = "127.0.0.1" ] || die "the agent must bind loopback only; refusing to provision"

render_env() {
  cat <<EOF
# Generated by scripts/provision-tenant.sh for tenant "$TENANT".
# Regenerating this file rotates the root workspace password. See --force.
WORKSPACE_MASTER_PASSWORD=$1
WORKSPACE_BIND_ADDR=$BIND_ADDR
INTERNAL_SERVICE_PORT=$AGENT_PORT
INTERNAL_SERVICE_BIND_HOST=$AGENT_BIND_HOST
INTERNAL_SERVICE_ALLOWED_ORIGINS=$ORIGINS
IMAGE_TAG=${IMAGE_TAG:-latest}
EOF
  [ "$INGRESS" = "tunnel" ] && echo "TUNNEL_TOKEN=${TUNNEL_TOKEN:-__SET_ME__}"
  return 0
}

render_vhost() {
  cat <<EOF
# $DOMAIN -> tenant $TENANT UI on 127.0.0.1:$UI_PORT
server {
    listen 80; listen [::]:80;
    server_name $DOMAIN;
    return 301 https://\$server_name\$request_uri;
}
server {
    listen 443 ssl; listen [::]:443 ssl;
    server_name $DOMAIN;
    http2 on;
    ssl_certificate     /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    client_max_body_size 500m;
    location / {
        proxy_pass http://127.0.0.1:$UI_PORT;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        # The UI reaches its agent over a WebSocket. Without these two the
        # connection is downgraded to a plain request and the app loads but
        # never connects -- which looks like an application bug, not an
        # ingress one, and is why they are here rather than left to a default.
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 180s;
        proxy_buffering off;
    }
}
EOF
}

# --- emit --------------------------------------------------------------------
echo "tenant      : $TENANT"
echo "topology    : $TOPOLOGY"
echo "ingress     : $INGRESS${DOMAIN:+ ($DOMAIN)}"
echo "ports       : server=$SERVER_PORT agent=$AGENT_PORT ui=$UI_PORT"
echo "directory   : $TENANT_DIR"

if [ "$DRY_RUN" = true ]; then
  echo "--- .env (password redacted) ---"
  render_env "__REDACTED__"
  [ "$INGRESS" = "nginx" ] && { echo "--- $DOMAIN.conf ---"; render_vhost; }
  echo "--- dry run: nothing written ---"
  exit 0
fi

mkdir -p "$TENANT_DIR"
# 0600 before content: never exists world-readable, even momentarily.
umask 077
render_env "$MASTER_PASSWORD" > "$TENANT_DIR/.env"
chmod 600 "$TENANT_DIR/.env"
cp docker-compose.production.yml "$TENANT_DIR/"
cp -r scripts "$TENANT_DIR/scripts" 2>/dev/null || true
cp deploy.sh "$TENANT_DIR/" 2>/dev/null || true

if [ "$INGRESS" = "nginx" ]; then
  render_vhost > "$TENANT_DIR/$DOMAIN.conf"
  echo "wrote $TENANT_DIR/$DOMAIN.conf"
  echo "NEXT: obtain a cert for $DOMAIN, install the vhost, then 'nginx -t && systemctl reload nginx'."
  echo "      The existing mx.avarok.net cert does NOT cover new names; expanding it touches"
  echo "      every other name on it, so a separate cert is the lower-risk choice."
fi
if [ "$INGRESS" = "tunnel" ] && [ -z "${TUNNEL_TOKEN:-}" ]; then
  echo "NEXT: set TUNNEL_TOKEN in $TENANT_DIR/.env (currently __SET_ME__)."
  echo "      Route the tunnel to the UI on 127.0.0.1:$UI_PORT ONLY -- never to the agent."
fi

echo "provisioned. Deploy with:  cd $TENANT_DIR && ./deploy.sh --no-pull$([ "$INGRESS" = tunnel ] && echo ' --tunnel')"
