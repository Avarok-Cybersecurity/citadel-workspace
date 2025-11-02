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
    printf '\033[1;33mProcessing submodule:\033[0m %s at %s\n' \"\$name\" \"\$sm_path\"

    # Add all changes including nested submodule references
    # Use --all to capture nested submodule pointer updates
    git add --all

    # Commit with message (allow empty commits)
    if git commit --allow-empty -m '$FULL_MSG'; then
        printf '\033[0;32m✓ Committed:\033[0m %s\n' \"\$name\"
    else
        printf '\033[0;31m✗ Commit failed:\033[0m %s\n' \"\$name\"
    fi

    printf '\n'
"

# Second pass: Update parent submodule references to nested submodules
echo -e "${GREEN}=== Step 2: Updating parent submodule references ===${NC}"
echo ""

# This ensures parent submodules commit the updated nested submodule pointers
git submodule foreach --recursive "
    # Check if there are any submodule changes to commit
    if ! git diff-index --quiet HEAD -- 2>/dev/null || git status --porcelain | grep -q '^M'; then
        printf '\033[1;33mUpdating references in:\033[0m %s\n' \"\$name\"
        git add --all
        if git commit --allow-empty -m '$FULL_MSG (submodule ref update)'; then
            printf '\033[0;32m✓ Updated:\033[0m %s\n' \"\$name\"
        fi
        printf '\n'
    fi
"

# Then commit the main repo
echo -e "${GREEN}=== Step 3: Committing main repository ===${NC}"
echo ""

cd "$ROOT_DIR"

echo -e "${YELLOW}Processing:${NC} Main repository"

# Add all changes including submodule pointer updates
# Use --all to ensure everything is staged, including submodule reference updates
git add --all

# Commit with message (allow empty commits)
if git commit --allow-empty -m "$FULL_MSG"; then
    echo -e "${GREEN}✓ Committed:${NC} Main repository"
else
    echo -e "${RED}✗ Commit failed:${NC} Main repository"
fi

echo ""

# Verify clean state
echo -e "${GREEN}=== Step 4: Verifying clean state ===${NC}"
echo ""

# Check if there are any uncommitted changes left
if ! git diff-index --quiet HEAD -- 2>/dev/null; then
    echo -e "${YELLOW}⚠ Warning: There are still uncommitted changes in the main repo${NC}"
    echo -e "${YELLOW}This might be expected if you made changes after starting commit.sh${NC}"
    echo ""
    echo -e "${YELLOW}Run 'git status' to see what's uncommitted${NC}"
    echo ""
fi

# Check submodules for uncommitted changes
SUBMODULE_STATUS=$(git submodule foreach --recursive --quiet "
    if ! git diff-index --quiet HEAD -- 2>/dev/null; then
        printf '\033[1;33m⚠ Uncommitted changes in submodule:\033[0m %s\n' \"\$name\"
        echo 'HAS_CHANGES'
    fi
")

if echo "$SUBMODULE_STATUS" | grep -q "HAS_CHANGES"; then
    echo ""
    echo -e "${YELLOW}Run './check-submodule-status.sh' to see details${NC}"
fi

echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  All commits complete!                                   ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}Next step:${NC} Run ./push.sh to push all changes"
