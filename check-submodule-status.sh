#!/bin/bash
# Script to check the status of all submodules recursively
# Identifies detached HEAD states and provides suggestions
#
# Usage: ./check-submodule-status.sh

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║  Checking submodule status recursively                  ║${NC}"
echo -e "${CYAN}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""

DETACHED_COUNT=0
TOTAL_COUNT=0

# Check main repo
echo -e "${GREEN}=== Main Repository ===${NC}"
MAIN_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$MAIN_BRANCH" = "HEAD" ]; then
    echo -e "${RED}✗ Main repo is in detached HEAD state${NC}"
    COMMIT=$(git rev-parse HEAD)
    echo -e "  Commit: $COMMIT"
    echo -e "  ${YELLOW}Fix:${NC} git checkout <branch-name>"
else
    echo -e "${GREEN}✓ On branch:${NC} $MAIN_BRANCH"
fi
echo ""

# Check all submodules recursively
echo -e "${GREEN}=== Submodules (Recursive) ===${NC}"
echo ""

git submodule foreach --recursive "
    printf '\033[0;36mSubmodule:\033[0m %s at %s\n' \"\$name\" \"\$sm_path\"

    # Get current branch
    BRANCH=\$(git rev-parse --abbrev-ref HEAD)

    # Check if we're in detached HEAD state
    if [ \"\$BRANCH\" = \"HEAD\" ]; then
        printf '\033[0;31m✗ Detached HEAD state\033[0m\n'
        COMMIT=\$(git rev-parse HEAD)
        printf '  Commit: %s\n' \"\$COMMIT\"
        printf '  \033[1;33mFix:\033[0m cd %s && git checkout <branch-name>\n' \"\$sm_path\"

        # Try to guess the branch
        BRANCHES=\$(git branch -r --contains \$COMMIT | grep -v HEAD | head -n 5)
        if [ -n \"\$BRANCHES\" ]; then
            printf '  \033[1;33mBranches containing this commit:\033[0m\n'
            echo \"\$BRANCHES\" | while read branch; do
                printf '    - %s\n' \"\$branch\"
            done
        fi
    else
        printf '\033[0;32m✓ On branch:\033[0m %s\n' \"\$BRANCH\"

        # Check for uncommitted changes
        if ! git diff-index --quiet HEAD --; then
            printf '  \033[1;33mWarning: Uncommitted changes detected\033[0m\n'
        fi

        # Check if branch is ahead/behind remote
        UPSTREAM=\$(git rev-parse --abbrev-ref @{upstream} 2>/dev/null)
        if [ -n \"\$UPSTREAM\" ]; then
            LOCAL=\$(git rev-parse @)
            REMOTE=\$(git rev-parse @{upstream})
            BASE=\$(git merge-base @ @{upstream})

            if [ \"\$LOCAL\" = \"\$REMOTE\" ]; then
                printf '  \033[0;32m✓ Up to date with remote\033[0m\n'
            elif [ \"\$LOCAL\" = \"\$BASE\" ]; then
                printf '  \033[1;33m⚠ Behind remote (needs pull)\033[0m\n'
            elif [ \"\$REMOTE\" = \"\$BASE\" ]; then
                printf '  \033[0;36m↑ Ahead of remote (needs push)\033[0m\n'
            else
                printf '  \033[0;31m⚠ Diverged from remote\033[0m\n'
            fi
        fi
    fi

    printf '\n'
"

echo ""
echo -e "${CYAN}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║  Status check complete                                   ║${NC}"
echo -e "${CYAN}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}Tips:${NC}"
echo -e "  • Fix detached HEAD by checking out a branch in the submodule"
echo -e "  • Use ${CYAN}git submodule update --remote${NC} to update submodules"
echo -e "  • Use ${CYAN}./commit.sh${NC} to commit all changes"
echo -e "  • Use ${CYAN}./push.sh${NC} to push all changes (skips detached HEAD)"
