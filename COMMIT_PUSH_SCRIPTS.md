# Commit and Push Scripts

Two utility scripts for managing commits and pushes across all submodules recursively and the main repository.

## Overview

- **`commit.sh`** - Commits changes to all submodules (recursively) + main repo with synchronized message
- **`push.sh`** - Pushes all submodules (recursively) + main repo to remote

Both scripts process:
1. All submodules recursively (including nested submodules)
2. The main repository

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

## Typical Workflow

```bash
# 1. Make changes across multiple submodules and main repo

# 2. Commit everything with synchronized message
./commit.sh "Add new workspace feature"

# 3. Push all changes to remote
./push.sh
```

## Error Handling

Both scripts use `set -e` to exit on first error:

- **commit.sh**: If a commit fails in any submodule, the script continues (commits are allowed to fail if there are no changes, despite `--allow-empty`)
- **push.sh**: If a push fails in any submodule, the script stops immediately to prevent partial pushes

## When to Use

### Use commit.sh when:
- ✅ You want synchronized commit messages across all repos
- ✅ You made changes in multiple submodules
- ✅ You want to version-lock all submodules together
- ✅ You need empty commits for synchronization purposes

### Use push.sh when:
- ✅ You've committed changes using commit.sh
- ✅ You want to push all repos in one command
- ✅ You need to ensure all submodules are pushed before main repo

## Notes

- Both scripts process submodules **before** the main repository
- Timestamps use local timezone (EST, PST, etc.)
- Scripts are safe to run multiple times
- No changes are lost if scripts fail midway
- Both scripts respect `.gitignore` settings via `git add .`

## Troubleshooting

### "Permission denied" error
```bash
chmod +x commit.sh push.sh
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
