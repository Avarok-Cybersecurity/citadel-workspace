Update Avarok Citadel SDK dependencies across all FOUR Cargo.toml locations in this workspace.

## Locations

The citadel deps exist in FOUR Cargo.toml files:
1. **Root**: `./Cargo.toml` — citadel_sdk, citadel_types, citadel_logging
2. **Internal Service**: `./citadel-internal-service/Cargo.toml` — citadel_sdk, citadel_logging, citadel_types, citadel_crypt, citadel_io
3. **ILM**: `./citadel-internal-service/intersession-layer-messaging/Cargo.toml` — citadel_logging, citadel_io
4. **Workspace Server**: `./docker/workspace-server/Cargo.docker.toml` — citadel_sdk, citadel_logging, citadel_types

## Behavior

**If `$ARGUMENTS` is provided** (e.g., `/avarok-update opfs-support`):
1. Change `branch = "..."` to `branch = "$ARGUMENTS"` in ALL four Cargo.toml files (replace all occurrences of `branch = "..."` pattern for Avarok deps only)
2. Run `cargo update` in the root workspace
3. Run `cargo update` in the `citadel-internal-service/` workspace
4. Run `cargo check` in both workspaces to verify compilation
5. Report the old and new branch names, and the new git commit hash

**If no arguments provided** (`/avarok-update`):
1. Run `cargo update` in the root workspace to pull latest commits for current branch
2. Run `cargo update` in the `citadel-internal-service/` workspace to pull latest commits
3. Run `cargo check` in both workspaces to verify compilation
4. Report the updated commit hashes

## Important Notes

- After running this command, you MUST rebuild Docker images with `docker compose build --no-cache server internal-service` since `tilt trigger` only restarts containers, it does not rebuild images with new SDK versions.
- The WASM client also needs rebuilding: `docker compose run --rm sync-wasm-client` followed by restarting the UI container.
- Always verify the new commit hash appears in build output to confirm the update took effect.
