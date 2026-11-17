/**
 * The oldest build that may keep running once this one is deployed: `minSeq` in `/version.json`
 * (vite.config.ts). A page running a build below it reloads at once (kill-switch.ts).
 *
 * The one place it is set, by hand, in the release that needs it: raise it to a moment before
 * that release's commit (unix seconds, `date +%s`) when older pages can no longer work against
 * what ships with it. Every build made after that moment has a seq above it; every build already
 * deployed has one below. It was an environment variable (CITADEL_MIN_BUILD_SEQ) that no deploy
 * ever set, so no release could rely on it.
 *
 * - 1794768948 (2026-11-15): Connect names its server (agent 0.12). An older page sends Connect
 *   without `server_address`; the agent answers it with "reload", and this reloads it first.
 */
export const MIN_BUILD_SEQ: number = 1794768948;
