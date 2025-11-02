#!/bin/bash
# Script to pull changes from remote for all submodules recursively and the main repo
# Usage: ./pull.sh [--rebase]
#
# Features:
# - Pulls ALL submodules recursively (if on a branch)
# - Pulls main repo
# - Updates submodules to match main repo's commit references
# - Handles detached HEAD states gracefully
# - Optional --rebase flag for rebase instead of merge

set -e  # Exit on error

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Check for --rebase flag
REBASE_FLAG=""
if [ "$1" == "--rebase" ]; then
    REBASE_FLAG="--rebase"
    echo -e "${CYAN}Using rebase mode${NC}"
fi

echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Pulling all submodules recursively + main repo         ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""

# Get the root directory
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Step 1: Pull all submodules recursively
echo -e "${GREEN}=== Step 1: Pulling submodules recursively ===${NC}"
echo ""

# Use git submodule foreach to process all submodules recursively
git submodule foreach --recursive "
    printf '\033[1;33mPulling submodule:\033[0m %s at %s\n' \"\$name\" \"\$sm_path\"

    # Get current branch
    BRANCH=\$(git rev-parse --abbrev-ref HEAD)

    # Check if we're in detached HEAD state
    if [ \"\$BRANCH\" = \"HEAD\" ]; then
        printf '\033[1;33mWarning:\033[0m Submodule is in detached HEAD state. Skipping pull.\n'
        printf '\033[1;33mInfo:\033[0m To pull this submodule, checkout a branch first:\n'
        printf '  cd %s && git checkout <branch-name>\n' \"\$sm_path\"
        printf '\n'
        exit 0
    fi

    printf '\033[1;33mBranch:\033[0m %s\n' \"\$BRANCH\"

    # Check for uncommitted changes
    if ! git diff-index --quiet HEAD -- 2>/dev/null; then
        printf '\033[0;31m✗ Uncommitted changes detected. Please commit or stash first.\033[0m\n'
        printf '\n'
        exit 1
    fi

    # Pull from remote
    if git pull $REBASE_FLAG origin \"\$BRANCH\"; then
        printf '\033[0;32m✓ Pulled:\033[0m %s\n' \"\$name\"
    else
        printf '\033[0;31m✗ Pull failed:\033[0m %s\n' \"\$name\"
        exit 1
    fi

    printf '\n'
"

# Step 2: Pull the main repo
echo -e "${GREEN}=== Step 2: Pulling main repository ===${NC}"
echo ""

cd "$ROOT_DIR"

# Get current branch
MAIN_BRANCH=$(git rev-parse --abbrev-ref HEAD)

if [ "$MAIN_BRANCH" = "HEAD" ]; then
    echo -e "${RED}✗ Main repo is in detached HEAD state${NC}"
    echo -e "${YELLOW}Cannot pull. Please checkout a branch first.${NC}"
    exit 1
fi

echo -e "${YELLOW}Pulling:${NC} Main repository"
echo -e "${YELLOW}Branch:${NC} $MAIN_BRANCH"

# Check for uncommitted changes
if ! git diff-index --quiet HEAD -- 2>/dev/null; then
    echo -e "${RED}✗ Uncommitted changes detected. Please commit or stash first.${NC}"
    exit 1
fi

# Pull from remote
if git pull $REBASE_FLAG origin "$MAIN_BRANCH"; then
    echo -e "${GREEN}✓ Pulled:${NC} Main repository"
else
    echo -e "${RED}✗ Pull failed:${NC} Main repository"
    exit 1
fi

echo ""

# Step 3: Update submodules to match main repo's commit references
echo -e "${GREEN}=== Step 3: Syncing submodules to main repo references ===${NC}"
echo ""

echo -e "${YELLOW}Running git submodule update --init --recursive...${NC}"
if git submodule update --init --recursive; then
    echo -e "${GREEN}✓ Submodules synced to main repo references${NC}"
else
    echo -e "${RED}✗ Submodule sync failed${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  All pulls complete!                                     ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${GREEN}Summary:${NC}"
echo -e "  • All submodules (recursive) pulled successfully"
echo -e "  • Main repository pulled successfully"
echo -e "  • Submodules synced to main repo commit references"
echo ""
echo -e "${CYAN}Note:${NC} If submodules are on tracking branches, they may be ahead"
echo -e "      of the commit referenced by main repo. This is normal."
echo -e "      Use ${CYAN}./check-submodule-status.sh${NC} to see current state."
