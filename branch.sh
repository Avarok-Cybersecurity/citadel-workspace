#!/bin/bash
# branch.sh - Create feature branches across all submodules and main workspace
#
# Usage: ./branch.sh <branch-name>
#
# This script:
# 1. Creates the branch in all submodules (deepest first)
# 2. Pushes an empty commit to each submodule
# 3. Creates the branch in the main repo
# 4. Runs push.sh to sync everything
# 5. Opens PRs for each repo

set -e

BRANCH_NAME="$1"

if [ -z "$BRANCH_NAME" ]; then
    echo "Usage: ./branch.sh <branch-name>"
    echo "Example: ./branch.sh feature-new-chat"
    exit 1
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to create branch in a repo
create_branch_in_repo() {
    local repo_path="$1"
    local repo_name="$2"
    local base_branch="$3"

    log_info "Creating branch '$BRANCH_NAME' in $repo_name..."

    cd "$repo_path"

    # Make sure we're on the base branch and up to date
    git fetch origin
    git checkout "$base_branch"
    git pull origin "$base_branch"

    # Check if branch already exists
    if git show-ref --verify --quiet "refs/heads/$BRANCH_NAME" 2>/dev/null; then
        log_warning "Branch '$BRANCH_NAME' already exists locally in $repo_name, checking out..."
        git checkout "$BRANCH_NAME"
    elif git ls-remote --exit-code --heads origin "$BRANCH_NAME" 2>/dev/null; then
        log_warning "Branch '$BRANCH_NAME' exists on remote in $repo_name, checking out..."
        git checkout -b "$BRANCH_NAME" "origin/$BRANCH_NAME"
    else
        git checkout -b "$BRANCH_NAME"
        log_success "Created branch '$BRANCH_NAME' in $repo_name"
    fi

    # Push empty commit
    git commit --allow-empty -m "Branch $BRANCH_NAME created"
    git push -u origin "$BRANCH_NAME"
    log_success "Pushed branch to remote"

    # Create PR (ignore errors if PR already exists)
    if gh pr create --title "$BRANCH_NAME" --body "Branch for tracking progress on $BRANCH_NAME" --base "$base_branch" 2>/dev/null; then
        log_success "Created PR for $repo_name"
    else
        log_warning "PR may already exist for $repo_name"
    fi
}

# Store the original directory
ORIGINAL_DIR=$(pwd)

echo ""
echo "=========================================="
echo "Creating branch: $BRANCH_NAME"
echo "=========================================="
echo ""

# Step 1: Create branch in intersession-layer-messaging (deepest submodule)
log_info "Step 1/4: Processing intersession-layer-messaging..."
ILM_PATH="$ORIGINAL_DIR/citadel-internal-service/intersession-layer-messaging"
if [ -d "$ILM_PATH" ]; then
    create_branch_in_repo "$ILM_PATH" "intersession-layer-messaging" "main"
else
    log_warning "intersession-layer-messaging not found, skipping..."
fi

# Step 2: Create branch in citadel-internal-service
log_info "Step 2/4: Processing citadel-internal-service..."
CIS_PATH="$ORIGINAL_DIR/citadel-internal-service"
if [ -d "$CIS_PATH/.git" ] || [ -f "$CIS_PATH/.git" ]; then
    cd "$ORIGINAL_DIR"
    create_branch_in_repo "$CIS_PATH" "citadel-internal-service" "master"
    # Update submodule reference
    git add intersession-layer-messaging
    git commit -m "Update intersession-layer-messaging for branch $BRANCH_NAME" || true
    git push origin "$BRANCH_NAME"
else
    log_warning "citadel-internal-service is not a submodule, skipping..."
fi

# Step 3: Create branch in citadel-workspaces (UI submodule - uses 'main' branch)
log_info "Step 3/4: Processing citadel-workspaces..."
CW_PATH="$ORIGINAL_DIR/citadel-workspaces"
if [ -d "$CW_PATH/.git" ] || [ -f "$CW_PATH/.git" ]; then
    create_branch_in_repo "$CW_PATH" "citadel-workspaces" "main"
else
    log_warning "citadel-workspaces is not a submodule, skipping..."
fi

# Step 4: Create branch in main workspace
log_info "Step 4/4: Processing main workspace..."
cd "$ORIGINAL_DIR"

# Make sure we're on master and up to date
git fetch origin
git checkout master
git pull origin master

# Check if branch already exists
if git show-ref --verify --quiet "refs/heads/$BRANCH_NAME" 2>/dev/null; then
    log_warning "Branch '$BRANCH_NAME' already exists locally, checking out..."
    git checkout "$BRANCH_NAME"
elif git ls-remote --exit-code --heads origin "$BRANCH_NAME" 2>/dev/null; then
    log_warning "Branch '$BRANCH_NAME' exists on remote, checking out..."
    git checkout -b "$BRANCH_NAME" "origin/$BRANCH_NAME"
else
    git checkout -b "$BRANCH_NAME"
    log_success "Created branch '$BRANCH_NAME' in main workspace"
fi

# Update submodule references
git add citadel-internal-service citadel-workspaces 2>/dev/null || true

# Push empty commit
git commit --allow-empty -m "Branch $BRANCH_NAME created"
git push -u origin "$BRANCH_NAME"
log_success "Pushed main workspace branch"

# Create PR for main workspace
if gh pr create --title "$BRANCH_NAME" --body "Branch for tracking progress on $BRANCH_NAME" --base master 2>/dev/null; then
    log_success "Created PR for main workspace"
else
    log_warning "PR may already exist for main workspace"
fi

# Run push.sh if it exists
if [ -f "$ORIGINAL_DIR/push.sh" ]; then
    log_info "Running push.sh to sync all changes..."
    cd "$ORIGINAL_DIR"
    ./push.sh || log_warning "push.sh completed with warnings"
fi

echo ""
echo "=========================================="
log_success "Branch '$BRANCH_NAME' created across all repos!"
echo "=========================================="
echo ""
echo "PRs created (check each repo for links):"
echo "  - intersession-layer-messaging"
echo "  - citadel-internal-service"
echo "  - citadel-workspaces"
echo "  - citadel-workspace (main)"
echo ""
