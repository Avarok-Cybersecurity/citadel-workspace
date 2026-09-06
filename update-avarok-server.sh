#!/bin/bash
set -e

SERVER="avarok2"
REMOTE_DIR="~/development/citadel-workspace-server"
CONTAINER_NAME="citadel-server"
IMAGE_NAME="citadel-workspace-server"

# `--init --recursive`, NOT `--remote`.
#
# `--remote` deliberately IGNORES the commit the superproject records and takes
# each submodule's branch tip instead — `master` for citadel-internal-service,
# because .gitmodules names it, and the remote's default branch for
# citadel-workspaces, because it names none. Those branches are not where the work
# is: at the time this was written, `origin/master` was 118 commits behind the
# agent's active branch and 42 behind the UI's.
#
# So this line deployed a server whose submodules were months older than the
# commit it had just pulled, with no error and nothing in the output to say so —
# the pointers the parent commit was tested against were discarded on the way in.
# The deployed tree must be exactly the tree that was validated, which is what the
# recorded pointers mean. Every other invocation in this repository already uses
# this form; this was the one that did not.
echo "==> Pulling latest changes on $SERVER..."
ssh $SERVER "cd $REMOTE_DIR && git pull --recurse-submodules && git submodule update --init --recursive"

echo "==> Stopping and removing old container..."
ssh $SERVER "docker stop $CONTAINER_NAME 2>/dev/null || true; docker rm $CONTAINER_NAME 2>/dev/null || true"

echo "==> Rebuilding Docker image..."
ssh $SERVER "cd $REMOTE_DIR && docker build --network=host -t $IMAGE_NAME -f docker/workspace-server/Dockerfile ."

echo "==> Starting new container..."
ssh $SERVER "docker run -d --name $CONTAINER_NAME --restart unless-stopped --network host $IMAGE_NAME"

echo "==> Waiting for server to start..."
sleep 3

echo "==> Verifying server is up..."
ssh $SERVER "nc -zv 127.0.0.1 12349"
nc -zv 51.81.107.44 12349

echo "==> Done! Server is running at 51.81.107.44:12349"
