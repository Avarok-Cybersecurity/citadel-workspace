#!/bin/bash
# Script to commit changes to all submodules recursively and the main repo
# Usage: ./commit.sh "commit message"
#
# Features:
# - Commits to ALL submodules recursively
# - Commits to main repo
# - Runs "git add ." before committing
# - Includes timestamp in commit message
# - Allows empty commits for synchronization

set -e  # Exit on error

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Get commit message from parameter or use default
COMMIT_MSG="${1:-Update}"

# Add timestamp to commit message
TIMESTAMP=$(date "+%Y-%m-%d %H:%M:%S %Z")
FULL_MSG="$COMMIT_MSG [$TIMESTAMP]"

echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Committing to all submodules recursively + main repo   ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${GREEN}Message: ${NC}$FULL_MSG"
echo ""

# Get the root directory
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# First, commit all submodules recursively
echo -e "${GREEN}=== Step 1: Committing submodules recursively ===${NC}"
echo ""

# Use git submodule foreach to process all submodules recursively
git submodule foreach --recursive "
    echo -e '${YELLOW}Processing submodule:${NC} \$name at \$sm_path'

    # Add all changes
    git add .

    # Commit with message (allow empty commits)
    if git commit --allow-empty -m '$FULL_MSG'; then
        echo -e '${GREEN}✓ Committed:${NC} \$name'
    else
        echo -e '${RED}✗ Commit failed:${NC} \$name'
    fi

    echo ''
"

# Then commit the main repo
echo -e "${GREEN}=== Step 2: Committing main repository ===${NC}"
echo ""

cd "$ROOT_DIR"

echo -e "${YELLOW}Processing:${NC} Main repository"

# Add all changes
git add .

# Commit with message (allow empty commits)
if git commit --allow-empty -m "$FULL_MSG"; then
    echo -e "${GREEN}✓ Committed:${NC} Main repository"
else
    echo -e "${RED}✗ Commit failed:${NC} Main repository"
fi

echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  All commits complete!                                   ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}Next step:${NC} Run ./push.sh to push all changes"
