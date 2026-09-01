
## Rounds 608-620 — the reconnection wedge, root-caused

Four observations across three different reconnection tests, all
`Test timed out: Elapsed(())` on the outer 240s budget against tests that take
~1.6s. The fourth (PR #288's coverage job, whose entire diff is inside
`#[cfg(test)]` in another crate) finally carried enough log to place it.

**Cause.** `trigger_rekey(wait_for_completion=true)` parks on a oneshot and, on
each 10s wait timeout, re-checks whether the version advanced; if not it loops
again — "the rekey might still complete". Nothing bounds that loop.
`spawn_rekey_process` has two exits, the shutdown signal and its inner task
ending; both log and fall off the end without taking the pending
`local_listener`. The oneshot sender lives in the manager struct, not the task,
so it is not dropped either. The caller waits for a notification nobody can send
and a version nobody will advance. The reconnection tests hit it because they
are the ones that tear a session down mid-rekey. Fixed in Citadel-Protocol #289.

**A prediction I got wrong.** The record previously predicted that merging #285
(a 60s bound on that loop) would clear this flake. It would not: a bound turns an
infinite hang into a 60s error, and the test still fails. #285 remains the right
backstop for any other way the notification could go missing; #289 removes the
cause.

**Three controls to get one that measured anything.** The first two versions of
the new test passed with the fix removed. Shutting a real peer down and
triggering immediately let the peer answer normally — `shutdown()` only signals,
and the task serves rekeys until it has seen ~2s of quiet. Waiting that quiet out
instead killed the peer's receiver, so the caller's *send* failed and it errored
before reaching the wait loop at all. Parking a caller needs a send that succeeds
into silence. Both false greens are written into the test.

**A false conclusion, caught before it was recorded.** Reading a truncated log
window I concluded the wedge was a synchronous lock acquisition with no `.await`
between two checkpoints — which would have meant no async timeout could ever fix
it. The missing checkpoint was simply outside the `tail -30`; it was there at
1ms. Widen the window before concluding from an absent log line.

**Also this wave.** `AddrInUse` killing `group_chat::test_internal_service_group_create`
at 0.012s: `get_free_port` bound `:0`, read the port and dropped the listener, so
the kernel could hand that same ephemeral port to another test process — and
nextest gives every test its own process, so no in-process registry can see it.
Ports now come from 20000..32000, below the ephemeral range on Linux and macOS,
partitioned by pid into disjoint 16-port blocks. Control: the old body returns
port 52060 and fails the range assertion. Two of that fix's three tests stay green
under the defect — they guard other properties and are not evidence about it.

Deleted `yjs-merkle-strategy/sync.ts`'s `determineSyncAction` and
`computeStateVectorHash`: a complete, plausible chunk-level sync strategy with
zero callers anywhere, tests included. The cost was never the dead bytes, it was
the false map.

## Rounds 621-634 — the permission model, audited operation by operation

Started as bookkeeping: 11 of 21 `Permission` variants are never referenced in
the server. Counting variants is the wrong question, though — what matters is
whether the OPERATION each one names is gated, under whatever name. Checked one
at a time:

- `DeleteWorkspace`, `UpdateWorkspace` — zero refs repo-wide, but both
  operations gate on admin-or-owner plus the master password. Redundant
  vocabulary.
- `UpdateNode`, `EditNodeConfig`, `UpdateNodeSettings` — covered by
  `EditTreeStructure` / `EditMdx`, chosen per-field by what the update changes.
- `ReadMessages` — group reads gate on `ViewContent`, writes on `SendMessages`.
- `BanUser`, `ManageDomains`, `ConfigureSystem`, `EditWorkspaceConfig`,
  `ManageNodeTypes` — no such operation exists in the server. The matrix offers
  toggles for capabilities that are not implemented. LOW, and misleading.
- Editing permissions (`UpdateMemberPermissions`) is admin-gated. Sound.
- **`UploadFiles` / `DownloadFiles` — gated by nothing.** See below.

**The one real hole.** `NodeResult::ObjectTransferHandle` auto-accepted every
transfer behind one global boolean, and neither file permission was consulted
anywhere in the server, while the matrix showed operators a "Files" category
with per-user toggles and allowed/total badges. `Permission::for_role` grants
Guest `ViewContent` and nothing else — its own comment says this makes the role
"strictly weaker than Member" — so a read-only Guest could push files into
server storage and pull them back out. Group messaging already carried exactly
this fix, in a comment describing a Guest posting into every room it could see.
The file path never received it. Twenty-third guarded/unguarded twin.

Attribution needed new kernel state, because transfer events arrive on a
different branch of the event loop than the per-connection actor and carry only
a session CID. Cleared by a `Drop` guard, not a line at the end of the loop:
that task has several exits and CIDs are reused, so a stale attribution would
let the next connection inherit the previous account's authorisation.

**A regression I checked for and did not find.** `User::new` builds an EMPTY
permission map, so a Member created at connect holds nothing at
`WORKSPACE_ROOT_ID`. Had `check_entity_permission` been a strict per-domain
lookup, the new gate would have refused every ordinary user and broken all file
transfer. It is not: the final fallback is
`Permission::for_role(&user.role) && is_member_of_domain(..)`, so Members keep
transferring and Guests do not. Worth writing down that this was verified
against the running code rather than assumed from the test, which had set the
permissions explicitly and so could not have caught it.

**Still open (LOW).** `get_workspace` is membership-gated, not
permission-gated, and banning only changes a role — so a banned account still
reads workspace name, description, metadata and office list. Recorded rather
than fixed: "ban" is not a wired feature (no operation, no gate), and building
one is outside this goal.

Also this wave: `update_workspace` gated on the master password alone and then
set `role = Admin` unconditionally. Correct exactly once — the seeded root
workspace is claimed that way — but the door never closed, and the password is
ROOT's, stored on every workspace by `create_workspace`. Any authenticated
holder could join a workspace they were not in and promote themselves to Admin
on it. `delete_workspace` had already been given the admin-or-owner check, in
the same file, with a comment explaining why.

## Open finding — a lagged broadcast subscriber loses updates silently

`async_kernel.rs:1688`. The per-connection broadcast receiver has capacity 100.
On `RecvError::Lagged(n)` it logs a warning and continues, so those n workspace
updates — node created/deleted/moved, member role changed — are gone, and the
client is never told it is stale. There is no resync response variant to send
instead, and the UI's full refetch (`post-auth-setup.ts`) runs on
authentication, not on demand.

Recorded rather than fixed, deliberately. Reachability is not demonstrated: a
connection must fall 100 STRUCTURAL broadcasts behind, and those are human-paced
in normal operation, so a client that far behind is probably disconnecting
anyway. The candidate fixes are a new protocol variant (regenerates the TS
bindings) or closing the connection so the client reconnects and refetches — the
second risks reconnect churn in exactly the overload conditions that produced
the lag. Neither is worth shipping on a hypothesis while the merge PRs are in
CI.

To promote this to a real finding, reproduce it: hold a client's socket while
driving >100 structural changes, then assert the client's tree diverges from the
server's.

## Rounds 635-648 — a proven HIGH behind a wrong hypothesis

`test_internal_service_peer_with_psk_negative_case` was ignored with the note
"Peer A is never sent a connect notification when the PSK will not verify — is
that intended?". The tempting move was to answer it from the source: a responder
should NOT be told about a connect whose PSK fails, because that is an oracle,
so the test's shape is wrong. Running it says the opposite. **A is notified.**
Round one works exactly as designed and both sides get their
`PeerConnectFailure`. Round two dies on the initiator's own side before A is
involved:

    [PeerConnect] connect_to_peer_custom FAILED:
        RekeyUpdate (12) "Rekey update error: Encryption failure"

So the finding is not about notifications at all: **a failed PSK connect poisons
the pair, and every later connect between those two peers fails — including one
carrying the correct password.** Mistype a peer session password once and you
cannot connect to that peer again. HIGH.

Reproduced minimally in `tests/psk_retry_after_failure.rs`: two rounds on a
freshly registered pair, round one mismatched, round two with both sides
presenting the same correct password. Every wait names its round, because
"round one passes and round two does not" IS the finding and a bare timeout
hides it.

Ruled out, each by experiment rather than reading:
  - the responder — round one notifies A correctly;
  - PSK connects in general — `test_internal_service_peer_with_psk` connects a
    fresh pair with the right password in ~2s;
  - a lingering virtual connection — adding `disconnect()` to `connect.rs`'s
    failure arm changed nothing (the repro killed my own first fix in minutes,
    which is what having a repro before a fix buys);
  - a stale password — `store_session_password` inserts, so round two does
    overwrite round one's value.

Residue narrowed to per-peer handshake state that failure never clears:
`peer_kem_states` is inserted per attempt and only ever `clear()`ed wholesale in
`session_manager`, with no per-peer removal on failure; the vconn is removed only
on an explicit `PeerSignal::Disconnect`; and `remove_session_password` exists for
this exact job as `#[allow(dead_code)]` with a TODO — written, never wired.

Left proven and ignored rather than guessed at. One confident fix in this area
was already refuted within the hour, and the next candidates are inside the KEM
handshake, where a plausible-but-wrong change would tear down working
connections. `-- --ignored` reproduces it in ~40s.

**Prediction resolved.** The record predicted #285 alone would clear the
reconnection wedge; that was wrong, and #289 (waking rekey waiters when the
process ends) is the actual cause-level fix. Evidence: `coverage` — the exact
job that failed on #288 with `reconnection_p2p_one_c2s ... Test timed out` —
passes on #289, as do `citadel_sdk (macos-latest)` and the Ratchet Stability
Test. Intermittent failures make that a strong signal, not proof.

## CORRECTION — #289 did not fix the reconnection wedge

This supersedes two earlier claims in this file: that the wedge was "Fixed in
Citadel-Protocol #289", and the entry asserting #289 was "the actual cause-level
fix" on the evidence of a passing `coverage` job.

Both are wrong, and the disproof is direct. PR #288's `citadel_sdk
(macos-latest)` job wedged on a base that CONTAINS #289 —
`reconnection_one_c2s::test_p2p_then_one_c2s_disconnect`, same 240s signature,
a fourth distinct test. And the warning #289 emits when it wakes a parked caller
("rekey process ended with a caller still waiting") appears ZERO times in that
log. Nobody was on that listener. #289 closed a real gap — its unit test fails
without it — but that gap was not this one.

The mistake worth keeping is the reasoning, not the conclusion: I treated ONE
passing job as evidence a known-intermittent failure was fixed. For a flake that
had already been seen four times, a single green run was never going to
distinguish "fixed" from "did not fire this time". The record said so
confidently anyway.

**What is actually known now**, after #290 made the phase markers survive CI's
`RUST_LOG=citadel=info` filter — 134 of them were bare `log::info!` and had been
dropped, which is why six observations produced no localisation at all:

  - Both peers complete phase one in full: register, C2S connect, C2S rekey,
    P2P register, P2P connect, P2P rekey.
  - The disconnecting side then never logs the line immediately after
    `conn.disconnect().await?`, and the other blocks for ever on the barrier it
    never reaches.
  - The only await between those two markers is that call, and the only
    unbounded await inside it is `while let Some(event) = subscription.next()`
    in the C2S branch of `disconnect()`.

PR #291 bounds that wait at 30s. It is offered as a bound, NOT as a proven fix:
there is no red-to-green control, because the hang still cannot be reproduced on
demand. What is controlled is that the new branch is live — setting the bound to
1ns fails `reconnection_c2s` with `RemoteDisconnectEventMissing (290)`.

If the wedge survives #291, the next log names a phase rather than a silence,
which is the point of having done #290 first.

## Gate verification — the guards were themselves controlled

A gate that cannot fail reports safety it never checked, which is the defect
this record is mostly about. So the gates were spot-controlled by planting the
violation each one exists to catch, and checking the exit code WITHOUT a pipe
(`| head` reports head's status, and that made three controls in this session
look green while they were red).

  - `check-handlers-cannot-panic` — planted `Some(1u8).unwrap()` in
    `requests/peer/connect.rs`. Exit 1, naming `connect.rs:36`.
  - `check-sender-identity` — rewrote `senderCid: peerCid.toString()` to
    `senderCid: payload.sender_cid` in `message-handler-routing.ts`. Exit 1,
    naming the line and explaining that `sender_cid` is chosen by the sender.
  - `no-new-unreferenced-exports` — planted an exported function nobody calls.
    Fails, naming it by path. It also carries its own guards: "scans a real
    corpus" and "has no stale entries".
  - `check-stack-reachable` — exit 1 with the UI unreachable. Its docstring
    records an earlier version that could NOT fail, because it read `fetch`
    error text and undici puts ECONNREFUSED in `error.cause` while `message` is
    the constant "fetch failed".
  - The four gates added this session (permission enforcement, listener
    fan-outs, generated artefacts, submodules populated) each shipped with their
    own control, one of which found a hole in the gate itself: reverting the
    file-transfer enforcement left `Permission::UploadFiles` matching, because
    `may_transfer`'s DOC COMMENT names it. Comments are now stripped before
    matching.

  - `check-intent-results-checked` — discarded the result of a `persist-tree`
    intent. Exit 1, naming the line and stating that the intent can resolve
    `{ success: false }`. Its docstring lists three user-visible data-loss bugs
    of that exact shape, each with a green toast on the other side of it.
  - `check-storage-keys` — added a `localStorage.getItem` of a key nothing
    writes. Exit 1, naming key and line.

The storage-keys control took two attempts, and the first failure was mine. I
planted a key that was neither read NOR written and the gate passed — correctly,
because the defect it guards is a key that IS READ and never written, which is
what makes a read return its default forever while the feature looks wired. A
control has to reproduce the defect's shape, not merely touch the same file.

  - `check-controls-are-wired` (UI) — planted an `<input defaultValue>` with no
    handler. Exit 1, naming file and line: "accepts input and discards it".
  - `check-presence-is-not-invented` (UI) — narrowed `isMemberOnline`'s return
    from `boolean | null` to `boolean`. Exit 1: "offline is an assertion about
    somebody who may be sitting right there."

Two of these controls were mis-aimed before they landed, and both mis-aims
looked like passes. One planted `isOnline: true` into `date-utils.ts`, which
that gate does not scan — it checks three named files. The other never planted
at all: zsh expanded an unquoted `--include=*.ts`, the file variable came back
empty, and the gate then "passed" against an unmodified tree. Neither produced
an error; both produced exit 0, which is exactly what success looks like.

That is now the fifth and sixth time in this session that a control silently
measured nothing. The reliable defence is to confirm the mutation applied before
reading the result — the two that were caught were caught because the planting
step printed what it did and the printout was wrong or absent.

**Correction to a count stated here earlier.** "All 43 gate scripts" counted only
`scripts/`. There are 44 there and 40 more in `citadel-workspaces/scripts/` —
**84** in total. Every one of them can fail, though a literal grep for
`process.exit(1)` misses `check-toast-clears-header`, which ends
`process.exit(failed ? 1 : 0)`; that is presence rather than reachability, and
the seven above are the sample that was actually exercised.

**Refuted while checking that.** Three npm aliases in the UI package.json —
`check:event-pairs`, `check:types`, `check:spec-copy` — appear in no workflow,
which looked like three gates written and never run. All three underlying
scripts ARE invoked by filename; only the aliases are redundant.
`check-every-gate-is-invoked` covers both script directories and was right.

## Audit against the original plan

The plan this work started from named specific defects. Checked one by one
rather than assumed closed:

| Plan item | State |
|---|---|
| `file-transfer/io.ts` fabricates a `/transfers/{id}/{name}` path and reports success without uploading | fixed — no such path, no `setTimeout` stub |
| `tree-deep-hierarchy.test.ts:409` `maxDepthSchemaSet = true; // Skip this test` | fixed — gone |
| Two `describe.skip`ped vitest files "needs rewrite for refactored API" | fixed — no `describe.skip` anywhere in `src/` |
| Seven orphaned specs with no npm script: chat-settings, native-file-picker, five reconnection/* | **all seven now in validate.yml** |
| Two toast systems mounted simultaneously | fixed — only `<Sonner />`, with the reasoning in App.tsx |
| Raw CIDs rendered as user identity in P2PPeerList | the flagged line is a React key and a handler argument, not display text |
| `typescript-client`'s `"test": "echo … && exit 0"` making a CI job unconditionally green | fixed — real `node --test`, plus an `assert-tests-exist` guard |
| ~697 hardcoded sleeps in the integration suite | **517 remain.** Reduced, not eliminated. |
| No root ErrorBoundary — one render throw white-screens the app | fixed — `AppErrorBoundary` wraps the router, and its recovery is `reloadApplyingAnyWaitingUpdate` rather than a plain reload, because a same-tab reload leaves the old service worker serving the old crashing shell. Three tests, one covering exactly that. |
| `aria-*` in 10 of ~207 files, no `jsx-a11y` lint rule | fixed — `eslint-plugin-jsx-a11y` installed and configured, plus `check-accessibility`, `check-clickables-are-keyboard-reachable` and `check-icon-button-names` gates |
| 124 components with zero responsive breakpoints | gated — `check-responsive-label-loss` and `check-mobile-layout` |
| `eslint.config.js` has `no-unused-vars`, `no-explicit-any` off | fixed — `no-explicit-any` is `"error"`. `@typescript-eslint/no-unused-vars` is deliberately off because `unused-imports/no-unused-vars` replaces it; leaving both on double-reports. Not a gap. |

The sleeps are the one item not closed. They are a runtime and flakiness cost
rather than a correctness defect — a `sleep()` followed by a real assertion is
slow, not false-passing — and the distinct footgun the record warns about
(`isVisible()` never waiting) is a separate thing, now guarded where it gated a
whole test. Recorded as outstanding rather than quietly dropped.

## The reconnection wedge did not recur on a fully-fixed base

PR #288 sits on a master containing all three pieces: #289 (waking rekey waiters
when the process ends), #291 (bounding `disconnect()`'s unbounded
`subscription.next()`), and #290 (making the 134 phase markers survive CI's
`RUST_LOG=citadel=info`). Its `coverage` job — the one that wedged before — now
reports:

    PASS [0.616s] citadel_sdk::reconnection_c2s
    PASS [1.146s] citadel_sdk::reconnection_both_c2s
    PASS [1.144s] citadel_sdk::reconnection_one_c2s
    PASS [0.928s] citadel_sdk::reconnection_p2p_only
    PASS [1.115s] citadel_sdk::reconnection_p2p_one_c2s
    PASS [0.029s] citadel_sdk::reconnection_markers_reach_ci

All five at normal durations, against 240.1s timeouts in six prior observations.

**This is a signal, not proof.** The flake is intermittent, and one clean run is
exactly the evidence that misled this record earlier — the entry asserting #289
had fixed it rested on a single passing `coverage` job and was wrong. What has
changed since is that the cause is now localised (the markers placed the hang
inside `disconnect()`), the unbounded wait there is bounded, and a recurrence
would name its phase rather than leaving four minutes of silence. The claim here
is "did not recur", not "is fixed".

Zero phase markers appear in that log, which is expected: nextest dumps captured
output only for FAILING tests.

**A different failure in the same job.** `prefabs::client::peer_connection::
tests::test_peer_to_peer_file_transfer::case_2` hit its 180s rstest timeout.
Unrelated to #288's diff, which is `#[cfg(test)]` in citadel_crypt, and passing
on master's recent runs.

**The coverage-slowness explanation is refuted.** The two cases sit side by side
in the same instrumented job:

    PASS [  1.721s] test_peer_to_peer_file_transfer::case_1
    FAIL [180.130s] test_peer_to_peer_file_transfer::case_2

Same binary, same instrumentation, 100x apart. Instrumentation does not slow one
case of a test by two orders of magnitude and leave its neighbour at under two
seconds. This is a hang.

The cases are `#[case(2)]` and `#[case(3)]` — peer counts — and nextest numbers
them by position, so the one that hangs is **three peers**, while two peers
completes in 1.7s.

That is the same shape as the reconnection wedge: a P2P operation that normally
takes seconds taking its whole timeout budget. It is intermittent (master
passes) and it is upstream, in `citadel_sdk`, with nothing in this repository
able to reach it. **It does not reproduce locally.** Four attempts, each closing one variable:

  1. `cargo test` x3 — INVALID. Every run died on "TestBarrier already set up",
     which the test says outright: run with `cargo nextest run` instead. The
     grep for `test result` matched nothing, so three blank lines and exit 0
     looked like three clean runs of something that never executed.
  2. `cargo nextest` x3, uninstrumented — 3/3 pass, ~2.2s.
  3. `cargo llvm-cov nextest` x2, CI's exact command down to
     `SKIP_EXT_BACKENDS=true` — 2/2 pass, ~1.4s. Instrumentation is not the
     variable. (Those runs were FASTER than (2) purely from a warm build cache;
     timings across differently-warmed runs are not comparable.)
  4. The whole `citadel_sdk` suite under coverage, 97 tests concurrent —
     158s, all pass, this test included.

What remains between here and CI: it runs ten crates together (476 tests, not
97) on a runner with fewer cores. So the hang needs broader concurrency or that
environment specifically — not instrumentation, not the test in isolation, and
not single-crate parallelism.

Recorded with its exact parameters and this elimination sequence rather than
pursued further. Four fixes in the neighbouring hang were implemented and
refuted this session; a fifth guess is worth less than telling the next person
which four variables are already closed.

## PR #288's three failures, characterised

A test-only PR — its entire diff is inside `#[cfg(test)]` in `citadel_crypt` —
collected three red jobs in one run. Each was read rather than assumed:

| Job | Cause | Reached the tests? |
|---|---|---|
| `core_libs (windows-latest)` | `os error 10013` (WSAEACCES) binding `127.0.0.1:0` in the upstream Citadel-Protocol repo's `citadel_proto` connection tests. Windows returns that when the OS-chosen ephemeral port lands in a Hyper-V reserved range. | yes, then failed on bind |
| `coverage` | The upstream 3-peer P2P hang, characterised above. Intermittent; master passes; does not reproduce locally through four levels of fidelity. | yes |
| `docker_nat_p2p (address_restricted)` | `target peer_b: failed to receive status: rpc error: code = Unavailable … EOF` while buildkit was loading Dockerfiles. | **no** — died during the image build |

None is attributable to the diff. Notably the third never ran a line of the
project's code: the log shows `#3 [peer_b internal] load build definition from
Dockerfile` immediately before the EOF.

Three independent infrastructure failures in one run says something about the
window rather than the change — and it is worth writing down that this was
established by reading three logs, because "three failures" is exactly the
count at which the cheap conclusion is "the PR broke something".

Not merged. The standing authorisation to force-merge is conditional on a green
pipeline, and a pipeline red for reasons outside the diff is still not green.

## Round 477 — the errno was stringified away, and the fix for it was inert

**Correction to Round 476.** I recorded #288's three CI failures as
"environmental, none from the diff" without the one comparison that could test
it. Made now: `core_libs (windows-latest)` passed on #285, #289, #290 and #291,
and #288's diff is a single `citadel_crypt` file. So *"not caused by the diff"*
is confirmed mechanically — a ratchet change cannot deny a socket bind — but
*"environmental"* was too strong: the job passes on other runners, so it is
runner-dependent, not a fixed property of the environment. It also is not
"unrelated": it blocks the merge either way.

**The failure.** 3 of 49: `test_many_proto_conns::{case_1,case_2}` and
`test_tcp_or_tls::case_1`, all `os error 10013` (WSAEACCES) binding
`127.0.0.1:0`. Windows denies an ephemeral bind when the port the OS picked lies
in a Hyper-V/WinNAT reserved range. Note `case_1` is **IPv4** — my earlier
"Hyper-V IPv6" note could not have explained it.

**What the control found.** The intended fix was a narrow retry: the denial
belongs to one port, not to the address, so drawing another port is the correct
response rather than a suppression. I then planted the defect — retargeted the
matched errno at one macOS actually produces and bound `192.0.2.1:0`. The retry
**did not fire**. Returned on attempt 1.

Because `create_listener` converted `citadel_wire`'s `anyhow::Error` with
`err.to_string()`. That destroys the errno *and* the kind: every bind failure
arrived as `ConnectionRefused` — a kind a bind cannot produce — or as
`Custom{kind: Other}`, which is exactly what the CI log shows. `raw_os_error()`
was always `None`, so the retry could never match, and would have shipped inert
while looking like a fix.

The same `to_string()` sat on the connect path, flattening a connect *timeout*
into `ConnectionRefused` — a distinction the SDK's reconnection logic depends
on. One shared `io_error_from_anyhow` now recovers the `io::Error` from the
anyhow chain at all four sites.

**Also found:** two drifted copies of the "can this case run here" guard. The
Windows IPv6/QUIC skip existed in `test_tcp_or_tls` only, so
`test_many_proto_conns` went on binding `[::1]:0` on Windows. Folded into one.

**Proof.** `bind_failure_preserves_errno_and_kind` — FAIL with the old
conversion restored, PASS with the fix, restoration re-verified. 49/49
`citadel_proto`. PR #292.

**The lesson, again.** This is the seventh control this session that measured
nothing — and the first where the thing it caught was *my own fix being dead*
rather than the control being misplanted. A retry loop that never executes is
indistinguishable from a working one unless you make the error it keys on
actually occur.

## Round 478 — three kernel maps that nothing ever pruned

Keyed by a CID pair and living for the life of the process:
`pending_peer_connect_signals`, `pending_peer_registrations`,
`peer_username_cache`. Entries go in when a peer request arrives and come out
only when the local user explicitly answers it. Nothing removed them at
teardown — not logout, not the stale-session path in `connect.rs`, not
deregistration.

So an **ignored** peer request — the ordinary case — stayed forever.

The leak is the lesser half. A CID is permanent per account, so an entry
survives logout and reconnection, and can later be matched against a request
the sender abandoned long ago. It survived deregistration too: the account is
deleted, its pending signals are still in memory.

`prune_cid_scoped_state(cid, peer_cid)` separates the two teardowns, which are
genuinely different. A session teardown kills every entry mentioning the CID on
**either** side of the key — as the local session, and as the peer some other
session holds a request from. A P2P-only disconnect leaves the session alive,
so only that pair goes; pruning by CID there would discard live requests from
unrelated peers. Wired at all five teardown sites.

**Controls.** Dropping the `|| key.1 == cid` side failed only the session test;
replacing pair scoping with CID scoping failed only the P2P test. Each control
broke exactly one test, which is what shows the three are testing different
properties rather than one property three times. Honest limit:
`nothing_survives_a_deregistration` does **not** discriminate the both-sides
property — it passed under the first control — so it is the weakest of the
three.

**The wiring, not the helper, is what rots.** Unit tests prove
`prune_cid_scoped_state`; they say nothing about whether the five call sites
still call it. `check-session-teardown-prunes-cid-state.mjs` requires every
site that removes a session (or calls `cleanup_state`) to prune within six
lines, and fails loudly if it matches *no* sites at all — a gate whose patterns
have gone stale reports safety it never measured. Control: removing the
deregister prune took it from "all 5 sites" to exit 1 naming that line.

84 checks now, all green.

## Round 479 — the rate limiter's cap is a trigger, not a bound (open decision)

`RateLimiter.max_tracked_cids` reads as a maximum. It is not one. The sweep at
`rate_limiter.rs:160` runs only when a **new** CID arrives at the cap, and only
reaps buckets older than `60 × refill_interval`. When every tracked bucket is
recent it frees nothing, and the insert proceeds regardless.

**Measured**, not inferred: with `max_tracked_cids = 3`, driving 10,000 distinct
fresh CIDs left `tracked_cids() == 10_000`. The cap constrained nothing.

**This is deliberate.** A test — `sweep_does_not_reap_recent_buckets_at_capacity`
— pins it, and says why: *"we'd rather over-track briefly than refuse a
legitimate caller a token. The bound is a soft watermark, not a hard cap."* So
this is a documented fail-open decision, not an oversight, and I reverted the
change I had written rather than reverse it unilaterally.

**Two things the author's rationale does not cover.** "Over-track briefly"
assumes the excess is transient; nothing bounds it. And production runs
`DEFAULT_MAX_TRACKED_CIDS = 100_000`, so the memory path is real, if gated by how
many distinct CIDs an attacker can obtain.

**A correction to my own first fix.** I proposed also reaping buckets at a FULL
budget, reasoning they are observationally identical to absent at any age — true,
and it would have been free. But `try_consume` refills to `max_tokens` and
decrements in the same call, so a bucket is *never* left full. The sweep would
have been dead code that read as a safeguard. Caught before committing.

**Why this is not mine to decide.** The only bound that does not leak requires
either evicting a partially-spent bucket — which hands its owner a fresh budget,
turning memory pressure into a rate-limit bypass where flooding new CIDs resets
a throttled one — or refusing new CIDs under pressure, which is fail-closed and
denies service to legitimate first-time callers. That is an availability
decision on a security control. Put to the user, who chose the hard ceiling and
asked for the cap to be raised alongside it.

**Resolved.** New CIDs are refused once the sweep frees nothing; established
buckets keep their exact budgets. The same measurement now returns **3** against
a cap of 3, where it returned 10_000. The cap moved 100_000 -> 1_000_000, sized
from the measured 32-byte entry: with hashbrown's control byte and ~87.5% load
factor that is ~40 bytes live, so 1M is ~40 MB against the old ~4 MB. Now that
the number can refuse a real caller it is an availability budget, so it is
computed rather than picked.

**Controls.** Deleting the refusal fails both new tests. Replacing it with LRU
eviction — the alternative I advised against — *also* fails both, which is the
point: `pressure_from_new_cids_cannot_reset_a_throttled_bucket` proves the bypass
is real, not theoretical. A flood of unseen CIDs would have handed a throttled
CID a fresh budget.

**Stale prose swept too.** Three comments restated the cap's value ("100k") and
one still called it a high-water mark. The values are gone from prose entirely
rather than updated — a duplicated constant is a stale constant eventually.

## Round 480 — two dead listeners closed, and a guard I duplicated

Swept for the campaign's most productive shape — one end of a mechanism built,
the other never connected — across the UI's event bus. `eventEmitter.on` takes
`event: string`, so nothing in the type system can tell a listener from a
listener that will never run.

Two genuine orphans of 46 subscribed names:

- `group:member-kicked` — could never fire. `MemberState` carries only
  `EnteredGroup` and `LeftGroup`, so a kick arrives as `LeftGroup` like any
  other departure. Kicks were always handled, by the member-left path; the extra
  subscription only made it look as though they needed their own.
- `instance:registry-update` — a second, dead way to write `knownInstances`,
  which is really maintained through `registerInstance()` from
  `channel-messaging` and `route-by-request-id`.

Neither is a broken feature. Both are removed, along with the doc comments that
described them as live handlers.

**I wrote a gate that already existed.** `check-event-listeners-have-emitters.mjs`
does exactly this, better — it understands the `workspaceEvents.on*Event` and
`this.listen` facades that mine did not, and both orphans were already on its
`RECORDED_DEAD` list from rounds #206 and #230. So this was a rediscovery of
tolerated debt, not a find. My duplicate is deleted. Third time this session I
have written a guard that existed elsewhere; the check is to grep for the
*mechanism* before building, not the symptom.

What caught me was the existing guard's best feature: it fails on a **vanished**
allowlist entry — a name recorded as dead that nothing subscribes to any more.
That is what stops an allowlist outliving the thing it excused and silently
covering the next dead listener. It is the same idea as a gate that fails when
it matches nothing.

**Correction to round #230.** Its entry said `knownInstances` "is always empty".
It is not: `registerInstance` populates it from three live call sites and
`findInstanceByCid` drives CID routing off it. The listener was redundant, not
load-bearing — a different finding with a different risk, and the note would
have sent the next reader down the wrong path.

## Round 481 — declining a peer registration registered them

The highest-consequence finding of the campaign so far, and it came from the
guards' own debt list rather than a fresh sweep. Reading what
`check-event-listeners-have-emitters.mjs` already tolerated led into the
registration path.

**The chain, all three layers confirmed:**

1. Decline sends `PeerRegisterRespond { accept: false }`
   (`peer-registration-store/lifecycle.ts`).
2. `respond_register.rs` calls `responses::peer_register(signal, accept, ..)`.
   It returns `Ok` — the decline was delivered — and the handler answers
   `PeerRegisterSuccess`. Accurate from the service's side.
3. `handlePeerRegisterSuccess` ran the acceptance path unconditionally:
   `isRegistered = true`, into `registeredPeers` and `outgoingRegistrations`,
   `p2p:peer-registered` emitted, and the new contact broadcast to the other
   tabs.

So declining somebody added them as a registered contact. And because
`p2p-auto-connect-service/event-handlers.ts` subscribes to
`p2p:peer-registered`, the decline **also opened an outbound P2P connection to
the person who had just been refused**. The test log is what surfaced that:
`P2PAutoConnect ... confirmed, initiating immediate connection`, on a path that
should have been a refusal.

**Where the fix belongs.** One response type carries two outcomes, so no
receiver can distinguish them from the message alone. Changing that is a
protocol change and a regeneration of the WASM bindings; the party that already
knows is the one that chose. The request id sent with a decline is recorded and
consumed when its response arrives. Bounded at 100 and consumed on match —
a decline whose response never comes would otherwise be remembered for the life
of the tab, which is the leak of round 478 rebuilt by hand.

**Control.** Removing the guard fails two of the three tests while the
acceptance test stays green — the point being that the guard is not suppressing
the registration path wholesale, only for responses to declines.

**The protocol smell stands and is not fixed here.** `PeerRegisterSuccess`
meaning both "they accepted" and "your refusal was delivered" is the root cause;
this closes the consequence. Recorded as open.

## Round 482 — auditing the debt lists themselves; one real finding, four correctly tolerated

Round 481 came out of the guards' own debt lists rather than a fresh sweep, so
this round audited them properly. Sixteen gates carry an allowlist or baseline.

**The one real finding, and it is open.** `ensure_messenger_open` documents its
own ambiguity: *"Returns true if the messenger was just opened, false if already
open **or being opened by another task**."* One `false` means two states, and
only one of them is ready. `message-send-operations.ts` awaits it at two sites,
discards the result, and sends immediately — so a send racing a concurrent open
goes out against a handle that is not there yet.

Bounded, though: `send_p2p_message_reliable` returns
`"No messaging handle found for local CID"`. It is a spurious, loud send failure
under a narrow race, not silent message loss. The fix belongs in the WASM
client — `ensure_messenger_open` should await an in-flight open rather than
report `false` — and that requires rebuilding committed WASM artefacts, which
this session must not do. Recorded rather than half-fixed. **Open.**

**Four entries checked and correctly tolerated.** Worth writing down, because
"the allowlist is accurate" is a finding and the next reader should not re-walk
them:

- `ConnectLoadingModal.errorMessage` — inert because `setConnectStatus("error")`
  is never called. On failure the catch closes the modal and raises a
  destructive toast with a friendly message. The dead prop is the remnant of a
  deliberate removal: "the third copy of a message two better channels were
  carrying".
- `LiveDocumentView.onSave` — already guarded, with the reasoning in place. The
  durable write lives in `useDocumentPersistence`; the callback must not stamp
  "Last saved" when no caller wants the content.
- `p2p:registration-declined` — fires on the DECLINER's side; the pending list
  re-reads from the store, so nothing is missed.
- The `ensureMessengerOpen` baseline entries are the finding above, not a
  false positive.

**What this round says about the campaign.** Four of five leads were debt that
had already been reasoned about and correctly left alone. That is the healthy
outcome for a debt list, and it is evidence the earlier rounds' judgement calls
held up — but it also means the allowlists are close to exhausted as a source of
new findings.

## Round 483 — the tests I added to #79 had never run in CI

CI turned #79 red on a job labelled "ESLint - citadel-workspaces", which was in
fact `citadel-workspace-client-ts`'s `test` script:

    node --test "dist/**/*.test.js"
    Could not find '.../dist/**/*.test.js'

Immediately above it, my own `assert-tests-exist.mjs` had printed
`2 compiled test file(s) found under dist/`. **The check and the runner
disagreed about whether the same files existed.**

Glob support in `node --test` varies by version, and CI pins Node 20, which has
none. Measured across the two versions available locally:

| Node | `dist/**/*.test.js` | `dist` (directory) |
|---|---|---|
| 18 | "Could not find" — the CI error exactly | 13 tests, 11 pass / 2 fail |
| 22 | 13 pass | only 1 test discovered |

Three behaviours from two versions, so neither form is safe to depend on. The
fix removes the dependency: `assert-tests-exist.mjs --print` emits the paths it
walked and the runner is given exactly those. One walk, two consumers, and they
can no longer disagree — which was the actual defect, not the glob.

**The uncomfortable part.** These 13 tests were added in #79 precisely because
they had never run. The glob matched nothing, `node --test` exits 0 on an empty
match, and the job was green. So they still had never run — the guard I wrote to
stop exactly this passed while the runner ran nothing, because it answered a
different question than the runner asked. A check must be wired to the thing it
guards, not to a re-implementation of it.

**Found on the way.** The 2 failures on Node 18 share one cause:
`ReferenceError: crypto is not defined`. The package calls
`globalThis.crypto.randomUUID()` with no import — fine in browsers and Node
>= 19, broken on 18. The requirement was implicit; `engines: { node: ">=20" }`
now states it, so a Node 18 consumer gets an install warning rather than a
ReferenceError at the first request id.

13/13 on Node 22, 13 discovered and run on Node 18. 84 checks green.

## Round 484 — an inserted line split an attribute from its item

#292's WASM Build Check went red with a cascade: unresolved `citadel_wire::quic`,
`socket_helpers`, `native_config`, `native_io`, `net`, and `io_error_from_anyhow`
missing from `super`. Six distinct-looking errors, one cause, all mine.

Citadel-Protocol's `citadel_proto` misc module had:

    #[cfg(not(target_family = "wasm"))]
    pub mod native_bind;

I inserted the shared helper using `\npub mod native_bind;` as the anchor. The
anchor matched exactly what I asked for — and landed **between the attribute and
the module it guarded**. The attribute bound to my new function instead.
`native_bind` lost its gate and began compiling for wasm32, where nothing it
imports exists, while the helper carried the stolen attribute plus its own.

**The lesson is about anchors, not about cfg.** An anchor that matches where I
asked is not the same as an anchor that matches somewhere *safe*. Inserting
before an item is unsafe whenever that item may be preceded by an attribute,
a doc comment or a decorator — the diff reads perfectly and the meaning moves.
Anchor on the attribute-plus-item together, or insert after a blank line.

**And it reached CI because I verified the wrong target.** I ran
`cargo check -p citadel_proto` and the native test suite, and stopped. CI checks
`citadel_sdk` and `citadel_pqcrypto` against `wasm32-unknown-unknown`, and that
is what caught it. Verified this time the way CI verifies: both wasm checks exit
0, native exits 0, 50/50 tests pass.

Recurring: this is the same family as the six controls that silently measured
nothing — the difference between what I intended a change to do and what it
actually did, closed only by running the thing that would notice.

## Round 485 — the Owner could not run their own workspace

`is_admin` is `user.role == UserRole::Admin`, exactly. `Owner` is a separate
variant, and `Permission::for_role` grants it everything except `All` and
`ConfigureSystem`. So every gate written on `is_admin` refuses the workspace
Owner while the permission editor shows them holding the grant.

An earlier round found this, fixed `add_member` and `remove_member`, and wrote
`member_gates_match_reported_permissions_test.rs` to pin it — a test that covers
exactly the two sites that were fixed. **Three more gates were left behind**, so
an Owner could add and remove members and still not:

- change any member's role (`update_workspace_member_role`)
- change any member's permissions (`update_member_permissions`)
- edit the tree schema (`UpdateTreeSchema`, in the dispatch layer)

This is the *fixes that were never propagated* pattern in its purest form: the
right fix, the right reasoning written down beside it, applied in one of the
places it belonged. Found by grepping the mechanism — `is_admin(` — rather than
the symptom.

**Deliberately narrower than the earlier fix.** `add_member`/`remove_member` now
ask for the permission. These three admit Admin and Owner only. Assigning a role
is a path to Admin, so widening to every holder of a member-management
permission would let a Custom role above editor rank mint an administrator.
That is an authorization-policy change; it is recorded here and not made.

**The other seven `is_admin` uses are fine.** They are `is_admin || is_member`
read-scoping checks, which an Owner passes as a member. `UpdateTreeSchema` was
the only one with no membership fallback, which is why it was the only dispatch
gate that needed changing. Checked individually, not assumed.

**Control.** All three reverted to `is_admin` fails exactly the three Owner
tests; the Admin tests and every ordinary-role refusal stay green — so the
change enables the Owner without widening to anyone else.

Split into `owner_gates_admit_the_owner_test.rs` at 162 lines with the fixture
helpers moved to `citadel-workspace-server-kernel/tests/common/src/member_test_utils.rs`, shared rather than copied: two
gate-test files asserting against a drifting fixture would let one pass while
the other tested something subtly different.

## Round 486 — round 485 opened a lockout, and the guard could not see it

`ensure_not_last_admin` refuses anything that would leave the workspace with no
administrator, because promotion needs one and there is no way back. It counted
`role == Admin` and fired only for an Admin target.

That was correct **while** `update_workspace_member_role` was gated on
`is_admin`. An Owner could not promote, so an Owner was no escape from an empty
admin set — and could not reach the demote path at all.

Round 485 let the Owner through that gate. The guard's premise changed and the
guard did not:

> an Owner alone in a workspace with no Admin demotes themselves to Member.
> The guard no-ops, because the target is not an Admin. Nobody who remains can
> promote anyone. The doc comment's own word for this state is *unrecoverable*.

So last round's fix opened a permanent workspace lockout. It never reached
master — #79 is unmerged, and `git branch -r --contains` confirms the commit
exists only on `followup/dx-and-gates` — but it was real, and I introduced it.

The guard now counts Admin **and** Owner and fires for either as the target.

**What this says about the earlier change.** Widening who may perform an action
is not only an authorization question. It changes which states are *reachable*,
and every invariant guarding those states has to be re-read against the new
reach. I checked the seven other `is_admin` gates for authorization and did not
ask what the widening made possible.

**Control.** Reverting to the Admin-only count fails three of the four tests and
leaves `an_owner_may_step_down_while_an_admin_remains` green — the fix refuses
the lockout without refusing legitimate step-downs, which a blanket refusal
would also have "passed".

## Round 487 — AddUsers was a route to Permission::All

Applying round 486's lens — *widening who may act changes which states are
reachable* — to the **earlier** widening, the one that moved `add_user_to_domain`
off `is_admin` and onto `Permission::AddUsers`.

`add_user_to_domain` writes a **caller-supplied** `UserRole`, and nothing looked
at which role was being handed out. `Permission::for_role` grants `AddUsers` to
every Custom role above the editor threshold (rank > 15), and
`create_custom_role` allows ranks 16–19 and 21–254. `user_id_to_add` may be the
caller. So:

    add_user_to_domain(me, me, WORKSPACE_ROOT_ID, UserRole::Admin)

passed the gate on `AddUsers`, reached `write_user_role` — which guards only the
last-admin invariant, never who is granting what — and set the caller's own role
to Admin. **A rank-16 Custom role could make itself an administrator, holding
`Permission::All`.**

Before that widening the gate was `is_admin`, so only an Admin could reach it,
and an Admin granting Admin is not an escalation. The widening created this.

**And round 485 opened the same door one step lower.** Letting the Owner into
`update_workspace_member_role` let an Owner grant Admin — and Admin carries the
`ConfigureSystem` that `for_role` deliberately withholds from Owner. Two rounds
running, my own change is the one that made a state reachable.

**The rule is containment, in the ranks the type already carries:** grant what
you outrank or match, never what is above you. Admin is `u8::MAX` so an Admin
still grants Admin; an Owner (20) grants Owner and below but not Admin; a Custom
role grants beneath itself. Equal ranks are permitted because they escalate
nothing.

**Control.** Removing the two checks fails exactly the three escalation tests —
so the exploit was real, not theoretical — while all three permitted-grant tests
stay green. A rule that refused everything would have satisfied the refusals
alone, which is why the permitted grants are asserted beside them.

**What to take from three rounds of this.** Each was found by asking what the
*previous* fix made reachable, not by reading new code. The authorization review
and the reachability review are different reviews, and the second one is where
these lived.

## Round 488 — a deep dive that did not find its target

`test_single_connection_transient::case_3` failed CI on
`assert!(udp_channel_rx_opt.is_some())`. The user's instruction was to fix the
flakiness permanently. **I did not find the cause.** What follows is what was
ruled in and out, so the next attempt starts further along.

**What the log establishes.** Both sides hole-punched `Ok`. **Zero** "fallback to
TCP only mode" warnings and **zero** driver retries in the entire run. The
failing case took 0.198s against ~0.7s for its siblings. So one side reached
connect with no UDP channel receiver while the other had one, and nothing had
failed.

**Reproduction attempts, all negative.** 97/97 locally; 180 runs of the four
transient cases; 12 more runs under deliberate CPU saturation (load average
15.9, confirmed). No failure, and the new diagnostics never fired.

**Hypothesis 1 — receiver falls back to TCP and tells nobody. Reproduces the
symptom exactly, but is not this failure.** Forcing that branch gives the same
assertion at the same line. The branch sets `udp_mode = Disabled` locally,
leaves the one-shot empty, returns `Void`, and never informs the initiator —
which installs its own receiver in `begin_connect` and still reports `Some`.
The downgrade propagates initiator→receiver (`send_success_as_initiator`
computes `tcp_only`) and not the reverse. **That asymmetry is real and worth
fixing on its own.** But the log shows the branch was never taken.

**Hypothesis 2 — the initiator's CONNECT overtakes the receiver's in-flight
punch. DISPROVEN.** A 1500ms delay on the receiver's punch, with the early
install removed, still passes: the ordering is serialised by the protocol.
Without that control I would have shipped a confident, wrong fix.

**What was changed, on its own merits, not as a claimed cure:**

- The receiver's one-shot is installed in the SYN handler, where it first learns
  `udp_mode`, rather than after the punch. SYN precedes every later stage, so
  the receiver now has a channel receiver from the moment UDP is known to be on
  — the invariant the existing `// TODO ensure this exists BEFORE udp socket
  loading` asks for.
- The later initialisation tested `tx.is_none()`, which is *also* true once the
  UDP loader has TAKEN the sender; the assignment then replaced the receiver
  holding the delivered channel with a fresh one nothing would ever send on,
  turning a working channel into a permanent await. It now initialises only when
  the pair has never been created.
- Both take sites now warn when `udp_mode` is Enabled and the receiver is
  absent, naming the side. The failure has to identify itself before it can be
  fixed, which is what #290's markers did for the reconnection wedge.

**Open.** Cause unidentified. Two named suspects eliminated, one invariant
strengthened, and the next occurrence will say which side it was.

## Round 489 — auditing the other accept/decline flows

Round 481's defect was a protocol response that means two opposite things.
This round asked the obvious follow-up: where else does the system have an
accept/decline, and does it make the same mistake?

**File transfer — correct, end to end.** `FileTransferStatusNotification`
carries `success` (did the operation work) AND `response` (accept or decline),
so the outcomes are distinguishable on the wire. The UI reads both:
`accepted: notification.response && notification.success`. This is the shape the
registration path should have had, and it is worth naming as the positive
example rather than only recording defects.

**Peer connect — same conflation, currently unreachable.**
`PeerConnectAccept` answers both outcomes with `PeerConnectAcceptSuccess`. The
log line immediately above it branches on `if accept { "accept" } else
{ "decline" }`, so the code knows which it was and still returns one type with
no outcome field.

It is not reachable today: the UI's only caller hardcodes `accept: true`, and
incoming connections are auto-accepted because consent was given at
registration — the gate round 481 fixed. The protocol also requires
registration before connect, so auto-accepting does not admit strangers.

So: a real latent defect, not a live one. Recorded as a note at the branch a
decline path would have to touch, because the next person to add "reject this
connection" would otherwise rebuild round 481 exactly.

**What this round did not find.** No new critical/high/medium. Two flows audited,
one correct, one latent. That is a thinner result than the last several rounds
and is reported as such.

## Round 490 — rank is not power, and the peer-connect ambiguity closed

Two things, both continuations of round 487's lens: *what did the previous fix
make reachable?*

### The containment rule I wrote in 487 was the wrong invariant

It compared ranks: grant what you outrank or match. That reads as containment
and is not.

`Owner` is rank **20** and holds **25** of the 27 permissions.
`create_custom_role` permits ranks 21–254, and a Custom role above the editor
threshold holds **9**. So a rank-21 Custom outranked Owner while holding roughly
a third of its authority — and the rank rule let it grant Owner, to itself.
Nine permissions minting twenty-five.

The rule now compares the permission sets: **you may not grant a role holding a
permission you do not hold.** `All` is the Admin wildcard and `has_permission`
honours it, so an Admin still grants anything; an Owner grants everything except
Admin, whose `All` they lack; and no role hands out authority it lacks.

Control: restoring the rank comparison fails exactly
`a_custom_role_that_outranks_owner_still_cannot_grant_owner` and leaves the other
seven green — including `a_custom_role_may_still_grant_a_role_it_fully_covers`,
which is what shows the rule refuses only what the grantor lacks.

### PeerConnectAcceptSuccess now says which answer was delivered

Round 489 recorded this conflation as latent and left a note. The user asked for
it fixed rather than annotated, which is right — a latent defect with a comment
is still a defect.

`accept: bool` added to the response and set at both construction sites, the
shape `FileTransferStatusNotification` already uses. The UI reads it, with both
directions pinned and controlled.

Also found while wiring it: the "already connected" idempotent shortcut returned
success **without consulting the answer**, so a refusal against a live connection
was reported as delivered while the peer stayed connected and nothing was
declined. Gated on `accept`.

### A generated-file hazard, caught before it shipped

Regenerating the ts-rs binding rewrote **37** files. The 36 unintended ones
**stripped their import statements while still referencing the imported types** —
`Accounts.ts` lost `import type { AccountInformation }` and kept using it. The
local ts-rs disagrees with whatever produced the committed files. Reverted;
committing them would have broken the TypeScript build for a one-field change.

## Round 491 — the same escalation through the other door

Round 487 closed the ROLE path: you cannot grant a role carrying authority you
lack. Asking what that left reachable found the permission path, untouched.

`update_member_permissions` was gated on `is_admin_or_owner` and then wrote
**caller-supplied** `Permission` values straight into the target's per-domain
map — the target possibly being the caller. `check_entity_permission` honours a
per-domain `Permission::All` before anything else.

So an **Owner could grant `Permission::All`** — to anyone, including
themselves — and with it the `ConfigureSystem` that `Permission::for_role`
deliberately withholds from Owner. A role is only a bundle of permissions, so
closing one door and not the other closed nothing.

Both now share one primitive: **grant what you hold, never more.**
`ensure_may_grant_role` delegates to `ensure_may_grant_permissions` with the
role's own set, so the two doors cannot drift apart — which is exactly how they
came to differ in the first place.

`Remove` is deliberately uncontained: it only takes authority away, and gating
it would refuse an Owner tidying up a permission they never held. That decision
is pinned by a test rather than left implicit.

**Control.** Removing the containment fails exactly the three escalation tests —
`All` to another, `All` to self, `ConfigureSystem` — and leaves all three
permitted-grant tests green, including an Admin still granting `All` and a
removal still succeeding.

**The pattern, four rounds running.** Every one of these was found by asking what
the previous fix made reachable, not by reading new code. Two were flaws in my
own fixes. Authorization review answers "may this actor call this?"; reachability
review answers "what states can they now reach?" — and every finding in this
sequence lived in the second.

## Round 492 — a third door: creating a workspace made you admin of every workspace

Rounds 487 and 491 closed the role door and the permission door. Enumerating
every write to `user.role` found a third.

`user.role` is a **single global field**. `is_admin` reads it and never asks
which workspace. `create_workspace` set it to `Admin` for every creator —
bootstrap or not.

`Permission::for_role` gives an Owner `CreateWorkspace`. So an Owner holding the
master password could create a throwaway workspace and come back a **global
Admin**, carrying the `ConfigureSystem` that `for_role` deliberately withholds
from Owner. Exactly the escalation the other two doors were closed against.

The creator now gets `for_role(Admin)` **scoped to the workspace they created**.
The bootstrap promotion survives untouched — with no workspace in existence that
account IS the administrator — and is asserted, because a fix that broke it
would otherwise look like a pass.

**Control.** Restoring the unconditional promotion fails
`an_owner_creating_another_workspace_does_not_become_a_global_admin`.

**Two process notes, both about my own work.**

The tests were first written as `if created.is_ok() { ...assert... }`. Had
creation been refused, every assertion would have been skipped and the file
would have passed while testing nothing. Replaced with `expect`, which also
proved creation genuinely succeeds — so the assertions do run.

The control's first planting **silently did nothing**: a `str.index` threw
before the replace, and the run that followed exercised unmodified code and
reported two passes. It was caught only because the planting step prints what it
changed. That is the seventh time this session a control has measured nothing,
and every catch has come from the same habit.

## Round 493 — completing the enumeration, and a gate so a fourth door cannot open

Three escalation doors were found one round apart, by hand. This round finished
the enumeration properly and then built the mechanism that was missing.

**Every site that grants authority, audited:**

| Site | Gate | Verdict |
|---|---|---|
| `write_user_role` | callers contained (rounds 487, 491) | safe |
| `remove_user_from_domain` (role reset, grant removal) | de-escalation | safe |
| `create_workspace` | bootstrap-only since round 492 | safe |
| `delete_workspace` | de-escalation | safe |
| `update_workspace` | `if !is_bootstrap { return }` | safe |
| first-member on connect | needs `WORKSPACE_ALLOW_FIRST_CONNECT_ADMIN` | safe |

No fourth door. That is worth writing down as a result in its own right: the
audit is complete, not merely "nothing else turned up while I was looking".

**Why a gate.** Three doors existed simultaneously because nothing kept the
promotion sites consistent with one another. `user.role` is a single global
field — `is_admin` reads it and never asks which workspace — so one ungated
assignment is a workspace-wide escalation, and each was found only by somebody
choosing to look.

`check-admin-promotions-are-gated.mjs` requires every
`role = UserRole::Admin|Owner` to sit within reach of a bootstrap check, the
operator-opt-in outcome, or a containment call. Demotions need nothing, since
Member/Guest/Banned only take authority away.

**Two controls, because this guard has two ways to be useless.** Planting an
ungated promotion takes it from "all 3 gated" to exit 1 naming the line. And
making its pattern stale — so it matches nothing — also exits 1, rather than
reporting that all zero promotions are safe. The second is the failure mode that
has bitten this campaign seven times.

85 checks now.

## Round 494 — the 3-peer hang, finally explained

`test_peer_to_peer_file_transfer::case_2` has timed out at 180s intermittently
for the whole campaign. Four escalating local reproductions failed to trigger it,
and it was recorded as characterised-but-unexplained. A fresh CI failure gave up
the answer, because the log localises it exactly: the last line before the
timeout is `test_common.rs` **AB2.5**, and the hang is the receive that follows.

```rust
tx.unbounded_send(b"Hello, world!").unwrap();
assert_eq!(rx.next().await.unwrap().as_ref(), b"Hello, world!");  // blocks forever
```

**The assertion required delivery UDP does not promise.** Two datagrams sent,
two receives awaited, all unbounded. One lost datagram blocks `rx.next()` for the
rest of the test.

And the ratio explains the pattern that had looked arbitrary: every connected
PAIR runs this assertion, so exposure scales with peer count. Three peers is
three pairs against one — which is exactly why case_2 fails and case_1 passes in
seconds.

**Two changes, each with its own control**, a dropped datagram simulated by
skipping the first send of each exchange:

| resend | active grace | drop | case_2 |
|---|---|---|---|
| no | yes | yes | FAIL — "no UDP datagram came back" |
| yes | no | yes | FAIL at 32s |
| yes | yes | yes | **PASS at 5.8s** |
| yes | yes | no | PASS |

The second change is the one I would not have found by reasoning. Resending
alone fixed the 2-peer case and **not** the 3-peer one, because the exchange is
mutual: a peer that finishes first stopped sending and slept, stranding a peer
whose datagram was lost. A peer holding two connections finishes one before the
other, which is why three peers exposed it. The grace period now keeps sending
rather than sleeping through.

The bound also converts a silent 180s hang into a failure that names what did not
happen — which is what made this diagnosable at all.

**On the earlier rounds.** Round 488 hunted a *different* intermittent failure in
this suite and did not find it; that one is still open, and its diagnostics
remain armed. This is a second, distinct flake in the same file, and the two
should not be conflated.

## Round 495 — a Windows-only gap, and the fourth guard I duplicated

Audited user-controlled input reaching the filesystem. `persist_node_content`
joins a node name onto the content root and writes `CONTENT.md` beneath it, so
anything escaping that base writes wherever it likes.

`validate_content_segment` already refuses empty, `.`, `..`, any leading `.`,
and `/ \ \0`. Thorough — with one gap a character list cannot close.

**`Path::join` REPLACES the base** when handed something carrying a prefix or a
root, so a segment does not need a separator to escape. On Windows `C:` has no
separator, no NUL and no leading dot: it passes every check and then discards
the content root. The fix asks the platform's own parser for a single `Normal`
component, which is correct by construction — a Prefix on Windows, an ordinary
filename on Unix.

**What the controls actually showed, which is less flattering than the finding.**

- Removing the new check failed nothing locally. On a Unix host any string
  without a separator already parses as one `Normal` component, so **no test
  here can discriminate that line**. It is kept because it is correct and free,
  and the comment says exactly that rather than implying coverage.
- Disabling the `.`/`..` sentinel check also failed nothing — `starts_with('.')`
  already covers both. Two checks, one property.
- Making the validator accept everything failed five tests, so the suite does
  discriminate against a broken validator. That is the control that mattered,
  and it is the one that revealed the next item.

**The fourth duplication.** `async_kernel.rs` already contained a
`content_segment_tests` module with seven tests covering exactly this. I wrote a
second module with the same name. It only surfaced because the accept-everything
control printed test paths and two module prefixes appeared. Deleted.

That is four times this session — a listener gate, an event guard, and now a
test module — that I have rebuilt something already present. The rule I keep
failing to apply: **grep for the existing guard, and for the existing tests,
before writing either.**

**A restore that destroyed work.** Reverting one control with `git checkout --`
discarded the uncommitted fix along with it, because the change had never been
committed. The reversible-edit pattern used everywhere else in this session does
not have that failure mode; the file-level revert does.

## Round 496 — ninety gates and no index, which is why four were rebuilt

Four times in this campaign I wrote a guard that already existed elsewhere and
better: a listener check, an event guard, a permission gate, and a whole test
module. Each surfaced by accident afterwards. This round asked why, instead of
resolving to be more careful.

**There are ninety gate scripts across two directories, and nothing listed
them.** `scripts/README.md` named five. The only way to learn whether a guard
already existed was to read ninety files, so the duplication was not
carelessness — it was the predictable outcome of an undiscoverable set.

`docs/GATES.md` is now generated from the scripts themselves — each gate's name
beside the first sentence of its own header, so the index cannot describe a gate
differently from how the gate describes itself. All ninety extracted a
meaningful summary; none fell back to a placeholder.

**Two controls, because an index has two ways to lie.** Adding a gate without
regenerating fails `--check`. And a search pattern that matches nothing fails
too, rather than reporting that all zero gates are indexed — the failure mode
that has bitten this campaign repeatedly.

**A gate that forbade documenting itself.** Publishing the index broke
`check-doc-assertions`: it matched `verify:` anywhere in a line, and the index
quotes that gate's own first sentence, which contains the word. So the guard
could not coexist with prose describing it — and the first thing anyone writing
about it would hit is a failure.

Annotations live in comments, in two documented forms (`# verify: …` and
`<!-- verify: … -->`); the parser now requires that position. Controlled both
ways: the loose pattern trips on the index again, and a pattern matching nothing
fails the gate's own anti-vacuity floor rather than passing silently. Three real
annotations still hold, which is what proves the tightening did not blind it.

## Round 497 — the shipped WASM and its source could diverge silently

Round 482 deferred a fix to `ensure_messenger_open` because it lives in the WASM
client. This round asked what that deferral actually rested on, and found
something larger than the fix.

`citadel-workspace-client-ts/pkg/*.wasm` is a **tracked binary**, and CI sets
`SKIP_WASM_BUILD=1` because no wasm-pack is installed there. So **CI never
rebuilds it**. Whatever binary is committed is what the browser loads, and a
change to the wasm-client Rust source does nothing at all until somebody
rebuilds and commits the artefact by hand.

That makes every wasm-client source change a candidate for this campaign's most
productive defect: a fix present in the source, reviewed, merged — and never
running. A security fix there would be indistinguishable from a working one.
Nothing detected it: no gate mentioned wasm.

The stamp records the source tree the binary was built from, content-addressed
rather than by date — git author dates move without the code changing, and stay
put when it does. `sync-wasm-clients.sh` writes it as part of the copy step, so
the ordinary workflow maintains it.

**Two controls.** A stamp that no longer matches the source tree fails, naming
both hashes. A missing stamp fails rather than passing for want of evidence —
which matters, because "no stamp" is exactly the state a fresh clone or a
sloppy rebuild produces.

**Honest limit, and it is in the script's own header.** This pins the
relationship from now on. It cannot retroactively prove that the binary
committed on 2026-08-31 was built from the source beside it; the dates are
consistent with that and dates are not proof.

**Round 482 stays open, and correctly.** The `ensure_messenger_open` fix is a
source change that CI cannot make effective, so shipping it without a rebuild
would have produced precisely the inert fix this gate now catches.

87 checks.
