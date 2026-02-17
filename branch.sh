#!/bin/bash
# Script to create and checkout a new branch in all submodules recursively and the main repo
# Usage: ./branch.sh <branch-name>
#
# Features:
# - Creates branch in ALL submodules recursively (innermost first)
# - Creates branch in main repo
# - If branch already exists, checks it out instead
# - Handles detached HEAD states gracefully

set -e  # Exit on error

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Validate argument
if [ -z "$1" ]; then
    echo -e "${RED}Usage: ./branch.sh <branch-name>${NC}"
    echo -e "${YELLOW}Example: ./branch.sh post-overhaul-work${NC}"
    exit 1
fi

BRANCH_NAME="$1"

echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Creating branch in all submodules + main repo          ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${GREEN}Branch: ${NC}$BRANCH_NAME"
echo ""

# Get the root directory
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Step 1: Create branch in all submodules recursively
echo -e "${GREEN}=== Step 1: Creating branch in submodules recursively ===${NC}"
echo ""

git submodule foreach --recursive "
    printf '\033[1;33mProcessing submodule:\033[0m %s at %s\n' \"\$name\" \"\$sm_path\"

    # Get current branch
    CURRENT=\$(git rev-parse --abbrev-ref HEAD)

    # Check if we're in detached HEAD state
    if [ \"\$CURRENT\" = \"HEAD\" ]; then
        printf '\033[1;33mWarning:\033[0m Submodule is in detached HEAD state.\n'
        printf '\033[0;36mCreating branch from detached HEAD...\033[0m\n'
    fi

    # Check if branch already exists locally
    if git show-ref --verify --quiet refs/heads/$BRANCH_NAME; then
        printf '\033[0;36mBranch already exists locally. Checking out...\033[0m\n'
        git checkout $BRANCH_NAME
        printf '\033[0;32m✓ Checked out:\033[0m %s (%s)\n' \"\$name\" '$BRANCH_NAME'
    else
        # Create and checkout new branch
        git checkout -b $BRANCH_NAME
        printf '\033[0;32m✓ Created:\033[0m %s (%s)\n' \"\$name\" '$BRANCH_NAME'
    fi

    printf '\n'
"

# Step 2: Create branch in main repo
echo -e "${GREEN}=== Step 2: Creating branch in main repository ===${NC}"
echo ""

cd "$ROOT_DIR"

echo -e "${YELLOW}Processing:${NC} Main repository"

# Check if branch already exists locally
if git show-ref --verify --quiet "refs/heads/$BRANCH_NAME"; then
    echo -e "${CYAN}Branch already exists locally. Checking out...${NC}"
    git checkout "$BRANCH_NAME"
    echo -e "${GREEN}✓ Checked out:${NC} Main repository ($BRANCH_NAME)"
else
    git checkout -b "$BRANCH_NAME"
    echo -e "${GREEN}✓ Created:${NC} Main repository ($BRANCH_NAME)"
fi

echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  All branches created!                                   ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${GREEN}Summary:${NC}"
echo -e "  • Branch '$BRANCH_NAME' created/checked out in all submodules"
echo -e "  • Branch '$BRANCH_NAME' created/checked out in main repo"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo -e "  • ./commit.sh \"your message\" — commit changes across all repos"
echo -e "  • ./push.sh — push all branches to remote"
