#!/bin/bash
# =============================================================================
# Deploy a custom kernel.toml to avarok2, then redeploy.
# =============================================================================
#
# The one thing this script does that `deploy.sh` does not is put a specific
# `kernel.toml` on the host. Everything else it used to do was a second, broken
# implementation of a deploy:
#
#   * `docker build ... -f docker/workspace-server/Dockerfile .` with no
#     `--target` builds the LAST stage in that file, which is `dev`
#     (`FROM builder AS dev`) — the toolchain image, not `production`. It also
#     compiled Rust on the production host, which deploy.sh removed on purpose.
#
#   * `docker run` passed no `WORKSPACE_MASTER_PASSWORD` and no env file, and
#     the kernel refuses to start without one
#     (citadel-workspace-server-kernel/src/main.rs:49). With
#     `--restart unless-stopped` that is a crash loop.
#
#   * `git reset --hard origin/dev-next` discarded whatever was checked out on
#     the production host — including any local change an operator was mid-way
#     through — and pinned the deploy to one branch regardless of what the
#     caller wanted. `dev-next` does exist; that is not the problem. Deciding
#     for the operator, destructively, is.
#
# So: upload the config, then hand off. `deploy.sh` reads `.env` and refuses a
# `__CHANGE_ME__` master password before touching anything, pulls prebuilt
# images rather than compiling, verifies every image came from the same commit,
# and leaves the data volumes alone.
#
# Usage:
#   ./restart-remote-server.sh <path-to-kernel.toml> [deploy.sh flags...]
#
# Example:
#   ./restart-remote-server.sh ./docker/workspace-server/kernel.toml --no-pull
# =============================================================================
set -euo pipefail

SERVER="${AVAROK_SSH_HOST:-avarok2}"
REMOTE_DIR="${AVAROK_REMOTE_DIR:-~/development/citadel-workspace-server}"
KERNEL_CONFIG_PATH="docker/workspace-server/kernel.toml"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

usage() {
    echo "Usage: $0 <path-to-kernel.toml> [deploy.sh flags...]"
    echo ""
    echo "Uploads the given kernel.toml to $SERVER, then runs ./deploy.sh there."
    echo "Any further arguments are passed straight to deploy.sh (--no-pull, --tunnel)."
    exit 1
}

if [ $# -eq 0 ]; then
    echo -e "${RED}Error: kernel.toml path not provided${NC}" >&2
    usage
fi

KERNEL_TOML_PATH="$1"
shift

if [ ! -f "$KERNEL_TOML_PATH" ]; then
    echo -e "${RED}Error: File not found: $KERNEL_TOML_PATH${NC}" >&2
    exit 1
fi

echo -e "${GREEN}==> Uploading $KERNEL_TOML_PATH to $SERVER${NC}"
scp "$KERNEL_TOML_PATH" "$SERVER:$REMOTE_DIR/$KERNEL_CONFIG_PATH"

# Confirm what landed, by size and modification time. `scp` reports its own
# success, which is not the same as the file being where the server will read it.
echo -e "${YELLOW}==> On the host:${NC}"
ssh "$SERVER" "ls -lh $REMOTE_DIR/$KERNEL_CONFIG_PATH"

echo -e "${YELLOW}==> Handing off to deploy.sh (${*:-no flags})${NC}"
ssh "$SERVER" "bash -lc 'set -euo pipefail; cd $REMOTE_DIR && ./deploy.sh $*'"

echo -e "${YELLOW}==> Confirming the port on the host...${NC}"
if ssh "$SERVER" "nc -z 127.0.0.1 12349"; then
    echo -e "${GREEN}✓ Server is listening on 12349${NC}"
else
    echo -e "${RED}✗ deploy.sh reported success but nothing is listening on 12349${NC}" >&2
    echo -e "${YELLOW}  Look at:${NC}" >&2
    echo "    ssh $SERVER 'cd $REMOTE_DIR && docker compose -f docker-compose.production.yml logs --tail=50 server'" >&2
    exit 1
fi
