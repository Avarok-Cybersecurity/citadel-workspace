# Known issues

Consolidated from the former `P2P_UX_ISSUES.md`, `LIVE_DOC_UX_ANALYSIS.md`,
`P2P_DISCOVERY_FINDINGS.md` and `ERROR_LOG.md`. Every entry below was
**re-verified against the current tree** — items already fixed upstream were dropped
rather than carried forward.

| # | Issue | Severity | Location | Status |
|---|-------|----------|----------|--------|
| 1 | Raw CIDs rendered as user identity | P1 | `p2p/P2PPeerList.tsx:36,178,181`, `p2p/PeerListItem.tsx:44`, `p2p/PeerDiscoveryModal.tsx:64`, `AccountManagementDialog.tsx:126` | Open |
| 2 | `ListRegisteredPeers` has no retry — rejects on first timeout | P2 | `lib/p2p-registration-service/discovery.ts:129` | Open |
| 3 | Leader/Follower badge leaks multi-tab internals to end users | P2 | `layout/sidebar/TopBar.tsx:167` | Open |
| 4 | Server-mode file transfer fabricates a success path, never uploads | P1 | `lib/file-transfer/io.ts:194,202,205` | Open |
| 5 | `MessageSendFailure` emitted alongside successful delivery | P2 | `lib/p2p/`, `citadel-internal-service` | Open — needs root-cause |
| 7 | YJS live-document sync loop (64MB of logs, browser hang) | P0 | the earlier chat editor | Closed — that editor and its Yjs sync were removed; chat documents are Citadel Docs documents kept in step by CdocChatSync, and a received YjsP2PSync is dropped (`lib/p2p/earlier-editor-sync.ts`) |
| 8 | Peer Discovery lists stale test accounts with no filter | P3 | `p2p/PeerDiscoveryModal.tsx` | Open |
| 9 | No progress detail during workspace load | P3 | `ui/workspace-loader.tsx` | Open |
| 10 | An earlier editor's chat document never opened on this device cannot be opened here: no snapshot crosses the chat, and opening it blank and merging the peer's moved copy would add a stray section. The tab says "not on this device" and that the peer still has it | P2 | `components/p2p/chat-document/chat-document-opening.ts` | Open — needs a snapshot hand-off on CdocChatSync |
| 11 | Two devices that moved the same earlier document from different originals hold their copies apart for good (only hellos cross; the conflict is recorded by the creator rule). The non-creator cannot adopt the creator's copy, because `applyPeerMigration` has no snapshot to apply | P2 | `lib/cdoc/chat/chat-migration-gate.ts`, `lib/live-doc-migration/held-apart.ts` | Open — same hand-off as #10 |
| 12 | Peers still on an earlier version get no Citadel Docs document: their YjsP2PSync is dropped (a line in the chat says so, once per peer) and they cannot open a `cdoc-` invitation | P3 | `lib/p2p/earlier-editor-sync.ts` | By design for this release; resolves when they update |

## Fixed upstream — do not re-report

| Issue | Fixed by |
|-------|----------|
| Duplicate messages on sender side | `addMessageToConversation()` now returns `Promise<boolean>`; listeners only fire when newly added (`lib/p2p/conversation-manager.ts:82`) |
| Direct navigation fails to claim session | `WorkspaceLoader` auto-claims an active session (`ui/workspace-loader.tsx:57`) |
| Live Doc creation required text in the message input | `P2PMessageInput.tsx:108` now allows empty input in live-doc mode |
| "Coming soon" placeholder settings tabs | `AppearanceSettingsTab` / `PrivacySettingsTab` are real, localStorage-backed |
| `Math.random()` mock presence in the user directory | Removed in the auth/session refactor |
| Simulated demo chat ("Kathy McCooper", Unsplash avatars) | Removed in the auth/session refactor |

## Fixed here

### Dialogs and scroll areas overflowed a 375px screen

The permission matrix — the widest thing in the product — rendered wider than a
375px viewport and horizontally centred, so it was clipped on **both** edges: the
whole PERMISSION label column off screen left, Guest off screen right. What an
administrator saw was a grid of checkmarks with nothing to say which permission
any row belonged to. The same shape pushed the role selector and remove button
off the member rows.

One symptom, three independent causes, each enough on its own:

1. **`DialogContent` is a grid**, and a grid item's `min-width` defaults to
   `auto` — it refuses to shrink below its own content. The `w-[calc(100%-2rem)]`
   beside it was therefore decorative, and because the dialog is centred with
   `translate-x(-50%)` the overflow split across both edges instead of running
   off the right. Fixed with `[&>*]:min-w-0` on the shared component, so all 27
   dialogs get it.
2. **Radix `ScrollArea` wraps viewport children in `display: table; min-width:
   100%`.** A table box sizes to its content, so a wide child widens that wrapper
   rather than being bounded by it — which makes `min-w-0` and `truncate` on the
   children inert, because there is no bounded width to shrink against. This is
   why adding `truncate` to MemberRow changed nothing on its own. Fixed in the
   shared component (18 call sites).
3. **`MemberRow` had no `min-w-0`/`truncate`** on the name and no `shrink-0` on
   the controls, so a 22-character generated username pushed them out.

The matrix also gained a sticky label column: containment makes it fit, the
sticky column makes it usable.

`tests-pw/permission-matrix-phone.spec.ts` asserts geometry rather than taking a
picture — the dialog's box inside the viewport, and the permission label and both
row controls in-viewport. That distinction mattered: the bounding-box assertion
passed twice while the remove button was still off screen, and only the
in-viewport check on the control itself disagreed.

This is the same `min-width: auto` hazard already documented in `TopBar`, where
it pushed the avatar off a 375px viewport. Third instance — treat it as standing.


### The member list reported an empty workspace while it was still loading

Was issue #6, "WORKSPACE MEMBERS shows 'No members yet' when members exist",
carried for a long time as *needs re-verification* — which is what a transient
wrong state does to a bug report: whoever checks it later sees a correct list.

`WorkspaceService.listMembers()` returns once the request has been **sent**; the
members arrive separately on a `members:loaded` event. The sidebar cleared its
loading flag in a `finally` attached to that send, so for the whole gap between
request and response it had `loading === false` and `members === []` and
rendered the definitive empty state — "No members yet. Use the + button to
discover peers" — about a workspace that had members and was merely fetching
them.

`components/admin/tabs/MembersTab.tsx` already handled this correctly, clearing
the flag in the event handler. The right implementation existed in the tree and
the sidebar never got it.

Fixed by ending the load when the response arrives, with a 15s fallback so a
reply that never comes degrades to the empty state rather than an indefinite
spinner. The same effect also now clears the previous node's members on a domain
change; they used to stay on screen attributed to the node just opened.

Covered by `tests-pw/member-list-loading.spec.ts`, which samples continuously
across the load. Asserting the end state would not catch this — the list is
correct a moment later, which is precisely why the issue survived so long.


### Nobody in the workspace was ever an administrator

**Symptom.** The Edit button was disabled on every office and room, for every
account, permanently — measured at 2s, 10s, 20s, 40s and 60s after load. The
console showed `role: Member` and `0 permissions` for the user who had just
supplied the master password and initialised the workspace.

**Cause.** Three separate faults, each of which alone was enough:

1. **No promotion ever ran.** The "Initialize & Become Admin" modal sends
   `UpdateWorkspace`, and `update_workspace` does contain correct promotion
   code — but the server seeds the root workspace at boot from
   `WORKSPACE_MASTER_PASSWORD`, so the workspace already exists and that flow
   never runs. `async_kernel.rs` adds each connecting user to the workspace as
   `UserRole::Member` and nothing else grants a role. In a deployed stack, no
   account was ever an admin. The server log said as much — users were "added to
   workspace domain" and never anything more.
2. **`GetUserPermissions` did not inherit.** It answered with
   `user.get_permissions(domain_id).unwrap_or_default()`, an exact-domain lookup
   returning empty for any domain the user was not explicitly added to. CLAUDE.md
   documents "Domain permissions inherit: Workspace → Office → Room"; this did
   not. It now reports through `check_entity_permission`, the same function that
   authorises the operation, so what the UI is told matches what the server will
   allow.
3. **The Owner role was weaker than Member.** `Permission::for_role` built each
   role by hand and the Owner arm had drifted: no ViewContent, SendMessages,
   ReadMessages, UploadFiles or DownloadFiles, and no EditMdx. Promoting someone
   to Owner in the admin UI took away their ability to read the workspace and
   chat in it, and still left them unable to edit a document. Owner is now
   derived from `Permission::ALL_VARIANTS` minus the two permissions it should
   not have, so a permission added later is included by default.

**Fixes.** The first member of the workspace is promoted to Admin where members
are actually added (`async_kernel.rs`); `Permission::ALL_VARIANTS` is the single
source of truth for what permissions exist, used by both the role definitions and
the server's permission reporting; and the frontend's two hand-written copies of
the model — which covered 16 of 27 permissions and offered Member an
`EditContent` the server refuses — now derive from one mirror.

**Guards.** `citadel-workspace-types/tests/role_permissions.rs` asserts the
hierarchy (Owner ⊇ Member ⊇ Guest, Owner has EditMdx, Owner is not Admin), and
`scripts/check-permission-parity.mjs` fails CI if the Rust enum and the
TypeScript mirror disagree on either the permissions or the roles. Both were
confirmed to fail against the pre-fix code before being relied on.

**Coverage.** `tests-pw/node-content-propagation.spec.ts` is no longer `fixme`:
it edits as the admin and asserts a member's open page receives the change
without reloading. The editor is the admin deliberately — EditMdx belongs to
Owner and Admin by design, so a two-member fixture can never reach it. The new
`adminMemberTest` fixture provides that pairing.

**Still outstanding.** The legacy `src/tests/office-mdx-content.test.ts` treats a
closed gate as a tolerated condition and logs "skipping editor read-back" in
three places. It registers its own account with `isFirstUser: true`, so whether
it is the admin depends on run order — making it fail hard would trade a false
pass for an order-dependent failure. It should adopt `adminCredentials()` when it
is ported to `@playwright/test`.

## Accepted trade-offs

### Lighthouse "Best Practices" is 96, not 100

`inspector-issues` reports one `ContentSecurityPolicyIssue` — a `kEvalViolation`
from cbor-x, the CBOR codec used for the P2P wire format.

It is a **feature probe, not a failure**. cbor-x runs `new Function('')` inside a
`try/catch` at module load (`node_modules/cbor-x/decode.js:46`) to decide whether
it may compile inline object readers for speed. Our production CSP is
`script-src 'self' 'wasm-unsafe-eval'` with no `'unsafe-eval'`, so the probe
throws, cbor-x catches it and permanently disables that optimisation. Chrome logs
the blocked probe regardless of the catch, and Lighthouse counts the log.

Verified under the production CSP that the fallback path is correct, not merely
quiet: an encode/decode round trip preserves nested structures and, critically,
`bigint` values (CIDs are bigint end-to-end — see CLAUDE.md).

The only way to clear the last 4 points is to add `'unsafe-eval'` to `script-src`,
which would materially weaken XSS protection on a security product to satisfy a
cosmetic score. Not done deliberately. Revisit only if cbor-x gains a build that
skips the probe.

### P2P messaging is unavailable for 2s after login (needs a backend signal)

`lib/session-startup-sequence.ts` waits `SDK_TEARDOWN_SETTLE_MS` (2000ms) after a
login before starting P2P setup, so the previous session's channel drops can
propagate through the protocol layer first.

**Corrected 2026-08-26 — this is NOT 2s of login latency.** The sequence runs
from an `eventEmitter.on('session:activated', ...)` listener, which nobody
awaits, so the user reaches the workspace immediately. What the delay defers is
`wasmConnectionManager.start()`, one step further down: for the first ~2s after
a login, ILM is not up, so messages cannot be sent or received. That is still
worth removing, but it is "messaging is briefly unavailable", not "every login
is 2s slower", and it should be prioritised as the former.

It is a guess in both directions: too short on a loaded backend and it races
anyway, too long and every login pays the difference. It stands because the
alternative today is blind-changing P2P connection sequencing — historically the
flakiest area of this codebase — with no signal to verify against.

**The fix belongs in the internal service.** It knows exactly when the old
Connection's channels are released and should emit that as an event. Once it
does, replace the delay with `waitForEvent(...)` from `lib/utils/scheduling`, and
login proceeds the instant teardown completes.

### Group-call pair connection hangs intermittently on CI

`call-group.spec.ts` connects three pairs (A-B, A-C, B-C). Twice on CI the
combined test burned its whole 420s budget and failed at a different point each
time — once on `page.screenshot: Timeout 10000ms`, once waiting for a workspace
to load after a peer request was accepted. It has never failed locally.

The obvious reading is "a 2-core runner driving three browsers is too slow".
The measurements refute it: split into one test per pair, each pair connects in
**~46s on the same CI hardware**, so the three together are ~140s against a 420s
budget. Time was never the constraint — one step was hanging.

Both observed stalls were in the conversation-open step of `connectPair`, after
the request was accepted, which is where to look first.

The split shipped because it isolates the failure — a named pair inside 240s
instead of a seven-minute test reporting only "pairwise" — and the first run
after it passed. That is one data point and does NOT establish the hang is gone.
Treat a recurrence as the same defect, now better labelled.

### Event listeners that nothing in the app ever triggers

Found by the same check that turned up three inert storage keys: compare who
EMITS an event name against who LISTENS for it. A listener with no emitter is
inert in exactly the way a read with no writer is.

Three survivors, all verified by grepping the literal across the whole source:

- **`lib/group-conversations/`** — `group-store.ts` subscribes to seven
  `group:*` events. Every one of them is emitted **only inside its own unit
  test**. Its consumer, `use-group-state.ts`, is imported by no component, and
  the group chat that actually works does not go through this store at all — it
  runs on `group-messaging-manager` and `workspace-response-handler/group-handlers`,
  which emit differently-named events (`group:message:new`, not
  `group:message-received`). This is a parallel module nothing mounts, and its
  tests pass because they supply the events themselves. Dead code with green
  tests reads as "group events are covered", which is why it is written down
  here rather than left to be rediscovered.
- **`connection:status-changed`** — the handler in
  `lib/p2p-registration-service/service.ts:79`. The string occurs exactly once
  in the source: at that listener.
- **`instance:registry-update`** — the handler in
  `lib/multi-instance/instance-manager.ts:82`. Same, exactly one occurrence.

None of this breaks anything a user can see; the features they belong to either
work by another path or were never finished. Left in place rather than deleted
because a handler that cannot fire is harmless, while removing one may discard
wiring someone intends to complete — that is a call for whoever owns the
feature, not for a sweep.

**Where the emit-vs-listen check works, and where it does not.** It is only
valid where handling requires naming the variant. `WorkspaceProtocolResponse` is
handled by explicit `isVariant(response, 'Name')` checks, so a variant with no
literal reference really is unhandled — that is how `NodeContentUpdated` was
found, the one response of 25 the UI ignored while the server broadcast it to
every other member.

`InternalServiceResponse` is the opposite. The UI dispatches generically —
`Object.keys(message)[0]`, then a generic `websocket-message` event that
consumers filter themselves — so a variant needs no literal reference to be
routed. Running the same comparison there reports 35 "unhandled" variants and
every one of them is meaningless. Do not file them.

**If you automate this check, expect false positives.** Three rounds of
refinement were needed: `io.emitEvent('x')` wrappers, a bare aliased `emit('x')`
after destructuring, and library events (`ydoc.on('update')`) that a third party
emits. A naive emit-vs-listen grep reported 15 orphans; 12 of them were wrong.

### The shadcn sidebar's own colour classes generate no CSS

`components/ui/sidebar.tsx` styles itself with `bg-sidebar`,
`text-sidebar-foreground` and `text-sidebar-accent-foreground` — 41 references
across the file. None of those tokens exists: there is no `sidebar` entry in
`tailwind.config.ts` and no `--sidebar-*` custom property in `index.css`, so
Tailwind never emits the utilities.

Confirmed against the built stylesheet rather than inferred: `.text-foreground`
and `.bg-card` produce 2 and 3 rules, while `.bg-sidebar`,
`.text-sidebar-foreground` and `.text-sidebar-accent-foreground` produce **zero**.

It is not a visible defect. The primitive inherits `foreground` from the body,
and the app's own wrappers under `components/layout/sidebar/` supply the
surfaces, which is why every responsive and accessibility scan passes. It is a
trap: someone adjusting sidebar colours will edit those class names and see
nothing change.

Two ways out, and they are not equivalent — deciding needs a look at the
rendered sidebar, which is why neither was applied:

- define the `sidebar` token family, which makes the primitive theme itself and
  WILL change how the sidebar looks, or
- delete the dead classes, keeping today's appearance and removing the trap.

### Continuous re-renders keep buttons from ever being "stable"

Playwright's actionability check waits for an element to stop moving before
clicking. On this app it can wait forever — observed as
`232 x waiting for element to be visible, enabled and stable` before a 120s test
timeout — because the UI re-renders continuously while BroadcastChannel leader
election settles.

Both test suites work around it by force-clicking (`click({ force: true })`), and
the legacy helpers say so explicitly: *"BroadcastChannel leader election can cause
continuous re-renders that keep the button 'not stable' indefinitely."*

The workaround is fine for tests, but the churn itself is a real cost: it burns
CPU and battery on every session, and it is why a click can feel unresponsive
just after load. The fix is on the app side — leader-election state changes should
not propagate into component render on every heartbeat. Worth profiling with the
React DevTools render highlighter before changing anything.
