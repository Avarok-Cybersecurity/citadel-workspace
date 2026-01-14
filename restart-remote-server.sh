#!/bin/bash
set -e

# Configuration
SERVER="avarok2"
REMOTE_DIR="~/development/citadel-workspace-server"
CONTAINER_NAME="citadel-server"
IMAGE_NAME="citadel-workspace-server"
KERNEL_CONFIG_PATH="docker/workspace-server/kernel.toml"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Usage function
usage() {
    echo "Usage: $0 <path-to-kernel.toml>"
    echo ""
    echo "Example:"
    echo "  $0 ./docker/workspace-server/kernel.toml"
    echo "  $0 /path/to/custom-kernel.toml"
    exit 1
}

# Check if kernel.toml path is provided
if [ $# -eq 0 ]; then
    echo -e "${RED}Error: kernel.toml path not provided${NC}"
    usage
fi

KERNEL_TOML_PATH="$1"

# Check if the kernel.toml file exists locally
if [ ! -f "$KERNEL_TOML_PATH" ]; then
    echo -e "${RED}Error: File not found: $KERNEL_TOML_PATH${NC}"
    exit 1
fi

echo -e "${GREEN}==> Using kernel.toml from: $KERNEL_TOML_PATH${NC}"

# Stop and remove old container
echo -e "${YELLOW}==> Stopping and removing old container...${NC}"
ssh $SERVER "docker stop $CONTAINER_NAME 2>/dev/null || true; docker rm $CONTAINER_NAME 2>/dev/null || true"

# Pull latest changes
echo -e "${YELLOW}==> Pulling latest changes from git...${NC}"
ssh $SERVER "cd $REMOTE_DIR && git reset --hard origin/dev-next && git pull origin dev-next"

# Update submodules
echo -e "${YELLOW}==> Updating submodules...${NC}"
ssh $SERVER "cd $REMOTE_DIR && git submodule update --init --recursive"

# Copy kernel.toml to remote server
echo -e "${YELLOW}==> Copying kernel.toml to remote server...${NC}"
scp "$KERNEL_TOML_PATH" "$SERVER:$REMOTE_DIR/$KERNEL_CONFIG_PATH"

# Verify the file was copied
echo -e "${YELLOW}==> Verifying kernel.toml was copied...${NC}"
ssh $SERVER "ls -lh $REMOTE_DIR/$KERNEL_CONFIG_PATH"

# Rebuild Docker image
echo -e "${YELLOW}==> Rebuilding Docker image (this may take a few minutes)...${NC}"
ssh $SERVER "cd $REMOTE_DIR && docker build --network=host -t $IMAGE_NAME -f docker/workspace-server/Dockerfile ."

# Start new container
echo -e "${YELLOW}==> Starting new container...${NC}"
ssh $SERVER "docker run -d --name $CONTAINER_NAME --restart unless-stopped -p 0.0.0.0:12349:12349 $IMAGE_NAME"

# Wait for server to start
echo -e "${YELLOW}==> Waiting for server to start...${NC}"
sleep 3

# Verify server is running
echo -e "${YELLOW}==> Verifying server is running...${NC}"
if ssh $SERVER "docker ps --filter name=$CONTAINER_NAME --format '{{.Status}}' | grep -q Up"; then
    echo -e "${GREEN}✓ Container is running${NC}"
else
    echo -e "${RED}✗ Container failed to start${NC}"
    echo -e "${YELLOW}Checking logs:${NC}"
    ssh $SERVER "docker logs --tail 20 $CONTAINER_NAME"
    exit 1
fi

# Verify port is accessible
echo -e "${YELLOW}==> Verifying port 12349 is accessible...${NC}"
if ssh $SERVER "nc -zv 127.0.0.1 12349" 2>&1 | grep -q "succeeded"; then
    echo -e "${GREEN}✓ Port 12349 is accessible${NC}"
else
    echo -e "${RED}✗ Port 12349 is not accessible${NC}"
    exit 1
fi

# Show recent logs
echo -e "${YELLOW}==> Recent server logs:${NC}"
ssh $SERVER "docker logs --tail 10 $CONTAINER_NAME"

# Get current commit info
echo ""
echo -e "${GREEN}==> Deployment complete!${NC}"
echo -e "${YELLOW}Current commit:${NC}"
ssh $SERVER "cd $REMOTE_DIR && git log --oneline -1"

echo ""
echo -e "${GREEN}✓ Server is running at 51.81.107.44:12349${NC}"
