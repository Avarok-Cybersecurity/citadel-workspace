#!/bin/bash
# =============================================================================
# Update the deployed server on avarok2.
# =============================================================================
#
# A thin SSH wrapper around `deploy.sh`, which runs ON the host. The genuinely
# useful part of this script has always been knowing WHICH host and WHERE the
# checkout is. Everything else it did was a second, worse implementation of a
# deploy that already existed — and none of that second implementation worked:
#
#   docker build --network=host -t citadel-workspace-server \
#                -f docker/workspace-server/Dockerfile .
#
#     No `--target`, so Docker builds the LAST stage in that file, which is
#     `dev` (`FROM builder AS dev`) — the multi-gigabyte toolchain image, not
#     `production`. It also compiled Rust on the production host, which
#     deploy.sh removed deliberately.
#
#   docker run -d --name citadel-server --restart unless-stopped \
#              --network host citadel-workspace-server
#
#     No `WORKSPACE_MASTER_PASSWORD`, and no env file. The kernel refuses to
#     start without it — citadel-workspace-server-kernel/src/main.rs:49,
#     "workspace_master_password is required" — so the container exited
#     immediately, and `--restart unless-stopped` turned that into a loop.
#
#   nc -zv 127.0.0.1 12349
#
#     Which then failed and reported a CLOSED PORT. An operator following this
#     script was told the network was wrong when the configuration was.
#
# That last one survived the first rewrite. The deployed server binds whatever
# `WORKSPACE_BIND_ADDR` in the host's `.env` says -- 12400 on avarok2 -- so the
# hardcoded 12349 reported a closed port after a deploy that had worked. The
# port is now read from that same file, and if it cannot be read this says so
# rather than guessing.
#
# `deploy.sh` does the whole job properly: reads `.env` and refuses a
# `__CHANGE_ME__` master password before touching anything, pulls prebuilt
# images from GHCR instead of compiling on the host, verifies every image came
# from the SAME commit, and restarts services sequentially without touching the
# data volumes.
#
# Its flags pass straight through:
#   ./update-avarok-server.sh                 # deploy :latest
#   ./update-avarok-server.sh --no-pull       # deploy the checked-out tree
#   ./update-avarok-server.sh --tunnel        # include the Cloudflare tunnel
# =============================================================================
set -euo pipefail

SERVER="${AVAROK_SSH_HOST:-avarok2}"
# The deployment, not a source checkout. `~/development/citadel-workspace-server`
# is a stale dev tree with no `deploy.sh` in it at all; pointing here was the
# first rewrite's mistake, and it made this script fail with "No such file or
# directory" for a deploy that was otherwise entirely correct.
REMOTE_DIR="${AVAROK_REMOTE_DIR:-/srv/citadel-tenants/avarok}"

echo "==> Deploying on $SERVER ($REMOTE_DIR)"
echo "    Arguments forwarded to deploy.sh: ${*:-<none>}"

# Fail on the real cause, before anything else runs. Without this the error is
# `bash: line 1: ./deploy.sh: No such file or directory`, which reads as a broken
# deploy rather than a script pointed at the wrong directory.
if ! ssh "$SERVER" "test -x $REMOTE_DIR/deploy.sh"; then
    echo "==> No executable deploy.sh in $REMOTE_DIR on $SERVER." >&2
    echo "    That path is the DEPLOYMENT, not a source checkout." >&2
    echo "    Set AVAROK_REMOTE_DIR if this deployment lives somewhere else." >&2
    exit 1
fi

# One SSH invocation, so a failure anywhere in the remote sequence stops the rest.
#
# No `git pull` here: deploy.sh does its own unless given --no-pull. The previous
# version pulled HERE and rebuilt THERE, which is how the two could end up
# disagreeing about which commit was being deployed.
#
# `bash -lc` for a login shell — deploy.sh needs docker on PATH, and a
# non-interactive `ssh host command` does not read the profile that puts it there
# on most installs.
ssh "$SERVER" "bash -lc 'set -euo pipefail; cd $REMOTE_DIR && ./deploy.sh $*'"

echo "==> deploy.sh finished. Confirming the port on the host..."

# The port comes from the same file the deploy reads. Hardcoding it is how this
# check came to report a closed port on a server that was serving: the literal
# said 12349 and `WORKSPACE_BIND_ADDR` said 12400.
#
# No fallback if it cannot be read. A guessed port turns "I could not tell" into
# "your server is down", which is the failure this whole script exists to stop.
port="$(ssh "$SERVER" "bash -lc 'set -euo pipefail; sed -n \"s/^WORKSPACE_BIND_ADDR=//p\" $REMOTE_DIR/.env | tail -1'" | tr -d '\r')"
port="${port##*:}"

if [ -z "$port" ]; then
    echo "    WARNING: could not read WORKSPACE_BIND_ADDR from $REMOTE_DIR/.env," >&2
    echo "    so the listening port is unknown and was not checked. deploy.sh" >&2
    echo "    verified the stack itself before returning." >&2
    exit 1
fi

if ssh "$SERVER" "nc -z 127.0.0.1 $port"; then
    echo "    Server is listening on $port."
else
    echo "    WARNING: deploy.sh reported success but nothing is listening on $port." >&2
    echo "    Look at:" >&2
    echo "      ssh $SERVER 'cd $REMOTE_DIR && docker compose -f docker-compose.production.yml logs --tail=50 server'" >&2
    exit 1
fi
