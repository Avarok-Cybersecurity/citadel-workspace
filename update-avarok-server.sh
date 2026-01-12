#!/bin/bash
set -e

SERVER="avarok2"
REMOTE_DIR="~/development/citadel-workspace-server"
CONTAINER_NAME="citadel-server"
IMAGE_NAME="citadel-workspace-server"

echo "==> Pulling latest changes on $SERVER..."
ssh $SERVER "cd $REMOTE_DIR && git pull --recurse-submodules && git submodule update --remote --recursive"

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
