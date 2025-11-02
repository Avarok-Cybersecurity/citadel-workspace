#!/bin/bash
# Script to push all submodules recursively and the main repo
# Usage: ./push.sh
#
# Features:
# - Pushes ALL submodules recursively
# - Pushes main repo
# - Stops on first error to prevent partial pushes

set -e  # Exit on error

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Pushing all submodules recursively + main repo         ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""

# Get the root directory
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# First, push all submodules recursively
echo -e "${GREEN}=== Step 1: Pushing submodules recursively ===${NC}"
echo ""

# Use git submodule foreach to process all submodules recursively
git submodule foreach --recursive "
    printf '\033[1;33mPushing submodule:\033[0m %s at %s\n' \"\$name\" \"\$sm_path\"

    # Get current branch
    BRANCH=\$(git rev-parse --abbrev-ref HEAD)

    # Check if we're in detached HEAD state
    if [ \"\$BRANCH\" = \"HEAD\" ]; then
        printf '\033[1;33mWarning:\033[0m Submodule is in detached HEAD state. Skipping push.\n'
        printf '\033[1;33mInfo:\033[0m To push this submodule, checkout a branch first:\n'
        printf '  cd %s && git checkout <branch-name>\n' \"\$sm_path\"
        printf '\n'
        exit 0
    fi

    printf '\033[1;33mBranch:\033[0m %s\n' \"\$BRANCH\"

    # Push to remote
    if git push origin \"\$BRANCH\"; then
        printf '\033[0;32m✓ Pushed:\033[0m %s\n' \"\$name\"
    else
        printf '\033[0;31m✗ Push failed:\033[0m %s\n' \"\$name\"
        exit 1
    fi

    printf '\n'
"

# Then push the main repo
echo -e "${GREEN}=== Step 2: Pushing main repository ===${NC}"
echo ""

cd "$ROOT_DIR"

# Get current branch
MAIN_BRANCH=$(git rev-parse --abbrev-ref HEAD)

echo -e "${YELLOW}Pushing:${NC} Main repository"
echo -e "${YELLOW}Branch:${NC} $MAIN_BRANCH"

# Push to remote
if git push origin "$MAIN_BRANCH"; then
    echo -e "${GREEN}✓ Pushed:${NC} Main repository"
else
    echo -e "${RED}✗ Push failed:${NC} Main repository"
    exit 1
fi

echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  All pushes complete!                                    ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${GREEN}Summary:${NC}"
echo -e "  • All submodules (recursive) pushed successfully"
echo -e "  • Main repository pushed successfully"
