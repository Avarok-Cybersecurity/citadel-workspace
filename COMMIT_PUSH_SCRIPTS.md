# Git Submodule Management Scripts

Utility scripts for managing commits, pushes, and pulls across all submodules recursively and the main repository.

## Overview

- **`pull.sh`** - Pulls changes from remote for all submodules (recursively) + main repo
- **`commit.sh`** - Commits changes to all submodules (recursively) + main repo with synchronized message
- **`push.sh`** - Pushes all submodules (recursively) + main repo to remote
- **`check-submodule-status.sh`** - Check status of all submodules (detached HEAD, uncommitted changes, etc.)

All scripts process:
1. All submodules recursively (including nested submodules)
2. The main repository

## pull.sh

### Usage

```bash
# Regular pull (merge)
./pull.sh

# Pull with rebase
./pull.sh --rebase
```

### Features

- **Pulls all submodules**: Pulls latest changes on current branch for each submodule
- **Pulls main repo**: Pulls latest changes on current branch for main repository
- **Syncs submodule references**: Runs `git submodule update --init --recursive` to match main repo's commit references
- **Detached HEAD handling**: Skips submodules in detached HEAD state with helpful warnings
- **Uncommitted changes detection**: Fails if uncommitted changes exist (prompts to commit or stash)
- **Rebase option**: Use `--rebase` flag for rebase instead of merge
- **Fail-fast**: Stops on first error to prevent inconsistent state

### Process Flow

1. **Pull each submodule** on its current branch (skips detached HEAD)
2. **Pull main repository** on its current branch
3. **Sync submodules** to match main repo's commit references

This ensures both:
- Submodules get latest changes on their tracking branches
- Submodules are at the commits referenced by main repo

### Output

```
╔═══════════════════════════════════════════════════════════╗
║  Pulling all submodules recursively + main repo         ║
╚═══════════════════════════════════════════════════════════╝

=== Step 1: Pulling submodules recursively ===

Pulling submodule: citadel-internal-service at citadel-internal-service
Branch: internal-service-mvp
✓ Pulled: citadel-internal-service

Pulling submodule: citadel-workspaces at citadel-workspaces
Branch: main
✓ Pulled: citadel-workspaces

=== Step 2: Pulling main repository ===

Pulling: Main repository
Branch: dev-next
✓ Pulled: Main repository

=== Step 3: Syncing submodules to main repo references ===

Running git submodule update --init --recursive...
✓ Submodules synced to main repo references

╔═══════════════════════════════════════════════════════════╗
║  All pulls complete!                                     ║
╚═══════════════════════════════════════════════════════════╝

Summary:
  • All submodules (recursive) pulled successfully
  • Main repository pulled successfully
  • Submodules synced to main repo commit references

Note: If submodules are on tracking branches, they may be ahead
      of the commit referenced by main repo. This is normal.
      Use ./check-submodule-status.sh to see current state.
```

### When to Use

- ✅ Start of work day - get latest changes from team
- ✅ After someone else pushes changes to submodules
- ✅ Before starting new feature work
- ✅ To sync your local repo with remote

## commit.sh

### Usage

```bash
./commit.sh "Your commit message"
```

### Features

- **Automatic staging**: Runs `git add .` in each submodule and main repo before committing
- **Synchronized messages**: All repos get the same commit message with timestamp
- **Timestamp inclusion**: Automatically appends timestamp in format `[YYYY-MM-DD HH:MM:SS TZ]`
- **Empty commits allowed**: Uses `--allow-empty` flag to allow synchronization commits
- **Recursive processing**: Handles nested submodules

### Examples

```bash
# Commit with custom message
./commit.sh "Fix authentication bug"
# Result: "Fix authentication bug [2025-11-02 14:58:17 EST]"

# Commit with default message
./commit.sh
# Result: "Update [2025-11-02 14:58:17 EST]"

# Synchronization commit (even if no changes)
./commit.sh "Sync submodule versions"
# Result: "Sync submodule versions [2025-11-02 14:58:17 EST]"
```

### Output

The script provides colored output showing:
- Which submodule is being processed
- Success/failure status for each commit
- Summary at the end

```
╔═══════════════════════════════════════════════════════════╗
║  Committing to all submodules recursively + main repo   ║
╚═══════════════════════════════════════════════════════════╝

Message: Fix bug [2025-11-02 14:58:17 EST]

=== Step 1: Committing submodules recursively ===

Processing submodule: citadel-internal-service at citadel-internal-service
✓ Committed: citadel-internal-service

Processing submodule: citadel-workspaces at citadel-workspaces
✓ Committed: citadel-workspaces

=== Step 2: Committing main repository ===

Processing: Main repository
✓ Committed: Main repository

╔═══════════════════════════════════════════════════════════╗
║  All commits complete!                                   ║
╚═══════════════════════════════════════════════════════════╝

Next step: Run ./push.sh to push all changes
```

## push.sh

### Usage

```bash
./push.sh
```

### Features

- **Automatic branch detection**: Pushes current branch of each submodule
- **Detached HEAD handling**: Automatically skips submodules in detached HEAD state with helpful warnings
- **Fail-fast**: Stops on first error to prevent partial pushes
- **Recursive processing**: Handles nested submodules
- **Clear status reporting**: Shows which repos are being pushed and their status

### Output

```
╔═══════════════════════════════════════════════════════════╗
║  Pushing all submodules recursively + main repo         ║
╚═══════════════════════════════════════════════════════════╝

=== Step 1: Pushing submodules recursively ===

Pushing submodule: citadel-internal-service at citadel-internal-service
Branch: internal-service-mvp
✓ Pushed: citadel-internal-service

Pushing submodule: citadel-workspaces at citadel-workspaces
Branch: main
✓ Pushed: citadel-workspaces

=== Step 2: Pushing main repository ===

Pushing: Main repository
Branch: dev-next
✓ Pushed: Main repository

╔═══════════════════════════════════════════════════════════╗
║  All pushes complete!                                    ║
╚═══════════════════════════════════════════════════════════╝

Summary:
  • All submodules (recursive) pushed successfully
  • Main repository pushed successfully
```

## check-submodule-status.sh

### Usage

```bash
./check-submodule-status.sh
```

### Features

- **Detached HEAD detection**: Identifies submodules in detached HEAD state
- **Branch suggestions**: Shows which branches contain the current commit
- **Uncommitted changes**: Warns about uncommitted changes in submodules
- **Remote sync status**: Shows if submodules are ahead/behind/diverged from remote
- **Comprehensive overview**: Check all submodules + main repo in one command

### When to Use

Run this script:
- ✅ Before running `./push.sh` to check for issues
- ✅ After pulling changes to see submodule states
- ✅ When troubleshooting push/commit problems
- ✅ To get an overview of repository status

### Output

```
╔═══════════════════════════════════════════════════════════╗
║  Checking submodule status recursively                  ║
╚═══════════════════════════════════════════════════════════╝

=== Main Repository ===
✓ On branch: dev-next

=== Submodules (Recursive) ===

Submodule: citadel-internal-service at citadel-internal-service
✓ On branch: internal-service-mvp
  ↑ Ahead of remote (needs push)

Submodule: intersession-layer-messaging at citadel-internal-service/intersession-layer-messaging
✗ Detached HEAD state
  Commit: 517b92b1234567890abcdef
  Fix: cd citadel-internal-service/intersession-layer-messaging && git checkout <branch-name>
  Branches containing this commit:
    - origin/main
    - origin/dev

╔═══════════════════════════════════════════════════════════╗
║  Status check complete                                   ║
╚═══════════════════════════════════════════════════════════╝

Tips:
  • Fix detached HEAD by checking out a branch in the submodule
  • Use git submodule update --remote to update submodules
  • Use ./commit.sh to commit all changes
  • Use ./push.sh to push all changes (skips detached HEAD)
```

## Typical Workflow

### Daily Development Cycle

```bash
# 1. Pull latest changes from remote
./pull.sh

# 2. Make changes across multiple submodules and main repo
# ... edit files ...

# 3. Check status of all submodules (optional but recommended)
./check-submodule-status.sh

# 4. Commit everything with synchronized message
./commit.sh "Add new workspace feature"

# 5. Push all changes to remote
./push.sh
```

### Quick Sync Without Changes

```bash
# Pull everything and sync
./pull.sh

# Check what changed
./check-submodule-status.sh
```

### Handling Conflicts

```bash
# Pull changes
./pull.sh

# If conflicts occur, resolve them in each submodule
cd submodule-with-conflict
# ... resolve conflicts ...
git add .
git commit -m "Resolve merge conflicts [timestamp]"
cd ../..

# Continue with normal workflow
./commit.sh "Merge remote changes"
./push.sh
```

## Error Handling

All scripts use `set -e` to exit on first error:

- **pull.sh**: If a pull fails in any submodule, the script stops immediately to prevent inconsistent state
- **commit.sh**: If a commit fails in any submodule, the script continues (commits are allowed to fail if there are no changes, despite `--allow-empty`)
- **push.sh**: If a push fails in any submodule, the script stops immediately to prevent partial pushes

## When to Use

### Use pull.sh when:
- ✅ Starting work - get latest changes from team
- ✅ Before making changes - ensure you have latest code
- ✅ After someone else pushes - sync with their changes
- ✅ Resolving "behind remote" status from check-submodule-status.sh

### Use commit.sh when:
- ✅ You want synchronized commit messages across all repos
- ✅ You made changes in multiple submodules
- ✅ You want to version-lock all submodules together
- ✅ You need empty commits for synchronization purposes

### Use push.sh when:
- ✅ You've committed changes using commit.sh
- ✅ You want to push all repos in one command
- ✅ You need to ensure all submodules are pushed before main repo

### Use check-submodule-status.sh when:
- ✅ Before pulling/pushing - identify potential issues
- ✅ After pulling - see what changed
- ✅ Troubleshooting - diagnose submodule problems

## Notes

- **pull.sh** pulls submodules first, then main repo, then syncs submodule references
- **commit.sh** and **push.sh** process submodules before the main repository
- Timestamps in commits use local timezone (EST, PST, etc.)
- Scripts are safe to run multiple times (idempotent)
- No changes are lost if scripts fail midway
- **commit.sh** respects `.gitignore` settings via `git add .`
- **pull.sh** requires clean working directory (no uncommitted changes)

## Troubleshooting

### "Permission denied" error
```bash
chmod +x pull.sh commit.sh push.sh check-submodule-status.sh
```

### Pull fails with "uncommitted changes"
```
✗ Uncommitted changes detected. Please commit or stash first.
```

**Fix options**:

1. **Commit your changes** (recommended):
   ```bash
   ./commit.sh "Work in progress"
   ./pull.sh
   ```

2. **Stash your changes temporarily**:
   ```bash
   # Stash in all submodules
   git stash
   git submodule foreach --recursive "git stash"

   # Pull
   ./pull.sh

   # Restore stashed changes
   git submodule foreach --recursive "git stash pop"
   git stash pop
   ```

### Pull creates merge conflicts
If pull.sh fails due to merge conflicts:

```bash
# Find which submodule has conflicts
./check-submodule-status.sh

# Go to that submodule and resolve conflicts
cd path/to/submodule
git status  # See conflicted files
# ... edit and resolve conflicts ...
git add .
git commit -m "Resolve merge conflicts"
cd ../..

# Continue pulling (will resume from where it stopped)
./pull.sh
```

### Push fails with "no upstream branch"
Set upstream for each submodule branch:
```bash
cd submodule-name
git push -u origin branch-name
```

### Want to see what would be committed without committing?
```bash
# Check status in all submodules
git submodule foreach --recursive "git status"

# See staged changes
git submodule foreach --recursive "git diff --cached"
```

### Detached HEAD error when pushing
```
✗ Detached HEAD state
Fix: cd citadel-internal-service/intersession-layer-messaging && git checkout <branch-name>
```

**What this means**: A submodule is not on a branch, but pointing to a specific commit (detached HEAD). This happens when:
- You check out a specific commit instead of a branch
- A submodule update points to a commit not on any branch
- You manually navigate submodule history

**Fix options**:

1. **Checkout an existing branch** (recommended):
   ```bash
   cd citadel-internal-service/intersession-layer-messaging
   git checkout main  # or whatever branch you want
   cd ../..
   ```

2. **Create a new branch from current commit**:
   ```bash
   cd citadel-internal-service/intersession-layer-messaging
   git checkout -b my-feature-branch
   cd ../..
   ```

3. **Skip the submodule** (push.sh automatically does this):
   - The push.sh script will skip detached HEAD submodules and continue
   - You can push them later after fixing the detached HEAD state

**Verify fix**:
```bash
./check-submodule-status.sh
```
