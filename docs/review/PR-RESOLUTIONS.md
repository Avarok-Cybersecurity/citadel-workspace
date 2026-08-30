# Review resolutions — PRs #65 and #66

Ready to post. Each finding names the commit and, where the reviewer's
reproduction was run, the result. Findings that did NOT reproduce are marked as
such with the evidence, rather than being quietly closed.

## PR #65 — Cleanup, harden, and complete the product lifecycle

**[P1] Preserve deserialization of stored permission records.** Fixed.
`#[serde(default)]` on `DomainPermissions::themes`, plus the legacy-JSON
regression test that was asked for (`citadel-workspace-types/tests/legacy_domain_permissions.rs`).
The test builds the legacy record by REMOVING the key from a serialised current
record rather than hard-coding an old shape, so it keeps testing the right thing
as the struct grows.

**[P1] Regenerate the lockfile from a clean, portable install.** Fixed
(`8b84fe8`), though not for the stated reason — worth being precise. The
`Missing: fsevents@2.3.3` half does not reproduce: `npm ci --dry-run` passes
under npm 10.9.4 (the workflow's Node 20 major) and 11.5.2 at this head. The
esbuild half is real and was fixed: `esbuild@0.21.5` declares 23 optional
platform packages and the lockfile recorded NONE, while rollup had all 32.
Builds only worked because esbuild's postinstall fetches its binary over the
network — the toolchain was being downloaded at install time rather than locked.
Cause was a stale nested `vite/node_modules/esbuild`. Applied surgically: a full
regeneration moved 203 packages including `@playwright/test 1.59.1 -> 1.62.1`,
which this suite is pinned around, so every record is copied from npm's own
clean resolution and version drift is zero.

**[P2] Serialize the whole-record theme update.** Fixed. The read/modify/write
is now under `lock_workspaces()`, metadata is MERGED rather than replaced (an
assignment erased the `initialized` marker and re-opened the setup modal over a
working workspace), and the denormalized `Domain::Workspace` copy is written too.

**[P1] Pass the active workspace ID when saving its theme.** Fixed.
`WorkspaceAppearanceSection` passes `workspaceId` through to
`updateWorkspaceTheme`.

**[P2] Add the TypeScript client tests this script now claims to run.** Fixed.
`scripts/assert-tests-exist.mjs` fails the command when no compiled tests are
discovered, and real tests exist. Verified by reproduction: with the test
sources removed `npm test` exits 1; with them present it exits 0 and runs 9
tests across 3 suites.

## PR #66 — Audio and video calling

**[P1] Commit a complete generated TypeScript client.** Fixed. `npm run build`
in `typescript-client` succeeds at this head.

**[P1] Route call media through the leader/follower architecture.** Addressed by
the second remedy the review allowed: the UI now restricts calling to the tab
that can perform it (`466aa5c`). Proxying open/close alone would yield a call
that connects and carries no media; making it genuinely work needs the frame
path proxied too, and frames leave 30-60x/second per track, so cloning each
through a BroadcastChannel taxes every user's frame path to buy multi-tab
calling. Reported as a capability, so the existing disabled-with-a-reason
treatment applies and the buttons explain where to call from. The ringing card
is gated the same way, so exactly one tab rings and it is the one that can
answer.

**[P1] Enforce media-session ownership on send and close.** Fixed (`2a5f658`).
`handle_send` resolves `(owner, outbound)` together and refuses the handle on a
mismatch. `handle_close` was subtler: its generation bump fires even with no
session, so a stale `MediaClose` could cancel the NEW connection's in-flight
open — peers now record `media_pending_owner` across the await. The decision is
a pure function with four tests covering the delayed old-owner cases, each
asserting both directions.

**[P1] Bound the high-rate media queues.** Fixed (`9b23208`). Media has its own
bounded lane that evicts the OLDEST frame; refusing the newest keeps the queue
permanently full of the stalest frames it holds. Gaps stay on the reliable path
— a dropped frame costs a sixtieth of a second, a dropped gap leaves the decoder
emitting garbage. The writer drains both with a biased select, control first.

**[P1] Tear down the call runtime when the local CID changes.** Fixed
(`fbf63e6`). Both caches are keyed on the identity they were built for,
construction re-checks after its awaits, and a change ends any live call.

## Not requested, found while here

`applyQualityReport` had no production caller, so congestion never left rung 0:
the encoder was configured once at full quality and never reconfigured, and four
of the five ladder rungs were unreachable. The whole adaptation was inert. Now
wired through the existing CallHeartbeat (`0050221`).
