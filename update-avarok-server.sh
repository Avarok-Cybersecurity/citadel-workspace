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
REMOTE_DIR="${AVAROK_REMOTE_DIR:-~/development/citadel-workspace-server}"

echo "==> Deploying on $SERVER ($REMOTE_DIR)"
echo "    Arguments forwarded to deploy.sh: ${*:-<none>}"

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

# Kept, but no longer the only signal, and no longer the FIRST thing to fail.
# deploy.sh has already verified the stack by this point, so a failure here means
# something changed between its check and this one — worth saying, and worth
# pointing at the logs rather than at the port.
if ssh "$SERVER" "nc -z 127.0.0.1 12349"; then
    echo "    Server is listening on 12349."
else
    echo "    WARNING: deploy.sh reported success but nothing is listening on 12349." >&2
    echo "    Look at:" >&2
    echo "      ssh $SERVER 'cd $REMOTE_DIR && docker compose -f docker-compose.production.yml logs --tail=50 server'" >&2
    exit 1
fi
