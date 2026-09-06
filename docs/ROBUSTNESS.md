
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

> **CLOSED in round 507, and the severity was wrong.** "Ban is not a wired
> feature" stopped being true: `update_workspace_member_role` takes any
> `UserRole`, and grant-containment permits `Banned` because its permission set
> is empty — so setting the role is an available operation and the gap was
> reachable, not theoretical. `get_workspace` now requires `ViewContent`, which
> `for_role` gives Guest and withholds from Banned.

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

> **SUPERSEDED by round 490.** Rank does not track power. `Owner` is rank 20 and
> holds 25 of the 27 permissions, while a Custom role may be created at rank
> 21-254 holding 9 — so the rank rule let a rank-21 Custom grant Owner, to
> itself. The rule now compares the permission SETS. This paragraph is left as
> written because the record is append-only; it describes what was implemented
> that round, not what is implemented now.

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

## Round 498 — regenerating the bindings breaks them, and only CI said so

Propagating round 497's mechanism — tracked generated artefacts CI never
rebuilds — to the other one: 102 ts-rs binding files under
`typescript-client/src/types`.

**Regenerating them is destructive.** ts-rs cannot see the types named inside a
`#[ts(type = "...")]` override, and `Accounts.accounts` carries one
(`Record<string, AccountInformation>`, because a JS object has string keys and
the Rust map does not). The generated file therefore USES `AccountInformation`
and never imports it. The committed files carry those imports, so they are ts-rs
output plus a hand patch — and running the export tests rewrites 36 files, each
dropping an import while still referencing the type.

That is the documented way to add a field to a wire type. I hit it in round 490
adding `accept` to `PeerConnectAcceptSuccess`, reverted the 36 by hand, and
recorded it as "the local ts-rs disagrees with whatever produced the committed
files". **That was right**: a full regeneration, all 106 export tests, does the
same thing. Verified this round rather than assumed.

**What was already covered, and what was not.** CI builds `typescript-client`
with `tsc` in three jobs and would fail on the corruption — so nothing ships
broken. Preflight type-checks the UI, not the bindings, so locally the corruption
was invisible: you would learn about it a full CI cycle later, in a job whose
name says nothing about ts-rs.

**The fix is the check that already existed, run earlier.** Preflight now runs
`typescript-client`'s own `tsc`. No new gate logic, nothing to rot, and the
control confirms it: dropping one import takes preflight from 88/88 to
`generated bindings typecheck … FAILED`.

**What I did not build.** A script to re-add the imports after regeneration. It
got as far as handling local `./Type` imports and then needed to know the
external type universe — 31 of the imports come from
`@avarok/citadel-protocol-types` — which is machinery that rots. Abandoned in
favour of failing fast and locally. The regeneration hazard is documented in
preflight beside the check that catches it.

88 checks.

## Round 499 — a pre-merge review of the NET diff, and what only that shows

#292 reached 30 green with no failures, so this round reviewed what it actually
contains before merging rather than trusting the running total.

Five commits, seven files — and two of the commits are corrections of the other
three: a wasm `cfg` regression I introduced, and a revert of my own hardening
that turned a 1.4s failure into a 90s hang. The net diff is coherent: one shared
error-conversion helper, its three call sites, the diagnostics, the
non-destructive one-shot init, and the two test changes.

**What the net diff showed that no commit did.** The surviving comment read:

> The sender is now installed in the SYN handler above, so this is a fallback for
> paths that reach here without one.

That install was added, then reverted two commits later. The sentence was **true
when written** and made false by a later commit on the same branch — so
reviewing each commit in turn shows nothing wrong, and only the net diff does.
It sat in the one place a reader goes to understand why the condition is written
as it is, describing a mechanism that does not exist.

This is the third stale-doc-asserting-current-behaviour instance of the campaign
and the first I have caught in my own work before it shipped. The mechanism that
caught it is worth naming: **review the net diff, not the commits.** A branch
that corrects itself will leave prose from the version it corrected.

Corrected, and a grep confirms no other reference to the withdrawn install
survives. 50/50 `citadel_proto`.

## Round 500 — the same review, applied to the bigger PR

Round 499's mechanism — review the NET diff, because a branch that corrects
itself leaves prose from the version it corrected — applied to #79: 53 commits,
45 files, +3389/-109, and an authorization rule rewritten three times.

It found the same defect, in the file whose whole purpose is to explain the rule.

`no_one_grants_a_role_above_their_own.rs` opened with:

> You cannot hand out a role that outranks you.
> …
> The rule is containment, using the ranks `UserRole` already carries: grant what
> you outrank or match, never what is above you.

That is the **withdrawn** rule. Round 490 replaced it, because rank does not
track power: `Owner` is rank 20 holding 25 of 27 permissions, and a Custom role
may be created at rank 21-254 holding 9 — so the rank rule let a rank-21 Custom
grant Owner, to itself. The header stated the old rule as current while the
section appended to the same file's foot explained why it was wrong. A reader
would have taken the title, which is what titles are for.

Header corrected to state the implemented rule — containment on the permission
sets — with the rank version kept explicitly as history.

**And the record itself.** Round 487's entry states the rank rule in the present
tense. It is append-only, so it stays; but a reader landing there had nothing
telling them it had been superseded. It now carries a pointer to round 490, and
says why it is left standing.

**Two rounds, two PRs, the same finding.** Per-commit review cannot see this
class: every commit is internally consistent, and the falsifying edit is
somewhere else in the same branch. The reviewable artefact is the net diff.

## Round 501 — a justification that its own later fix had retired

Third application of the net-diff review, and the third finding of the same
class — this time not a wrong description of behaviour, but a **stale reason**.

`is_admin_or_owner` explained why it stays narrow:

> widening it to every holder of a member-management permission would let a
> Custom role above editor rank mint an administrator. That is an
> authorization-policy change and is recorded as an open question rather than
> made here.

True when written. Rounds 490 and 491 then added `ensure_may_grant_role` and
`ensure_may_grant_permissions`: **nobody grants authority they do not hold,
whichever gate admitted them.** So widening this gate no longer lets anyone mint
an administrator, and the stated reason for keeping it narrow had been retired
by my own later commits, in the same branch.

This is the more dangerous variant. A wrong description of behaviour is caught
the moment someone tests it. A stale *reason* is only ever read — and it points
in two wrong directions at once: someone might refuse a reasonable widening on a
risk that no longer exists, or widen it and conclude the escalation was never
real.

Corrected in both places that carried it, the function's doc and
`owner_gates_admit_the_owner_test`'s header. The gate stays Admin-and-Owner; the
argument is now the smaller true one — role assignment is an administrative act
— and the question of widening is explicitly no longer blocked on the
escalation.

**Three rounds, three findings, one mechanism.** All three were prose made false
by a later commit on the same branch: a comment describing a reverted install, a
title stating a replaced rule, and now a justification retired by its own
follow-up. None is visible per commit. The net diff is the reviewable artefact,
and reasons rot as readily as descriptions.

## Round 502 — a second unbounded receive, and a hypothesis the data killed

`stress_test_group_broadcast::case_1` timed out at 90s on #292, having passed in
**8.4s on the run immediately before, in the same job**.

**The obvious explanation was wrong, and the log says so.** The test before it
took 88s, which reads like a machine under load. But comparing the two runs, that
same test took **97.7s on the passing run and 88.0s on the failing one** — the
machine was *faster* when the hang happened. Loaded-runner is refuted, not
merely doubted; this is a real intermittent hang.

**Why it produced no output.** The receive loop was
`while let Some(msg) = rx.next().await`, unbounded, and its break requires every
one of the n-1 senders to reach `count` exactly. One message short and it waits
for the rest of the test. The per-message log is trace-level and CI runs at
`citadel=warn`, so the failure was ninety seconds of silence saying only that
ninety seconds had passed.

Same class as the UDP assertion in round 494: **an unbounded await on a receive,
where any shortfall is indistinguishable from a hang.** Two instances now, in the
same suite, found a round apart.

The budget does not repair a shortfall — it makes the next one legible. Control:
sending one message fewer per peer yields

> group broadcast stalled after 30s: saw 2 of 2 expected sender(s), per-sender
> counts {…: 499, …: 499}, each needing 500

in 36s instead of a silent 90s timeout. "One sender seen" and "both senders
reached 499 of 500" are different bugs, and neither was distinguishable before.

**Still open.** What causes the shortfall. The instrumentation is what makes the
next occurrence answerable, which is exactly how round 494's cause was found —
by a log that named where it stopped.

## Round 503 — propagating the unbounded-receive fix I had not propagated

Rounds 494 and 502 each fixed an unbounded await on a receive. Two instances a
round apart is a class, so this round did what should have followed round 494
immediately: grep the mechanism.

**Three more, in `udp_media_modes`.** The client sends a datagram and awaits its
echo — twice, unbounded — and the server's echo loop awaits each payload
unbounded. UDP does not promise delivery, so one dropped datagram parks the test
until its timeout with nothing said about which exchange stalled.

**Bounding, not resending, and the reason is in the code.** Round 494's remedy
was to resend until the echo arrives. It is wrong here: this echo is strictly
counted at two payloads, so a resent datagram draws an extra echo, exhausts that
count early and strands the second exchange. The same defect class does not
imply the same fix, and applying 494's remedy mechanically would have introduced
a new hang while removing an old one.

Control: dropping the client's first datagram yields *"no UDP datagram within
30s while waiting for first"* in 31.5s — naming the side and the exchange —
against a silent hang before. 4/4 pass unmodified, 97/97 across the suite.

**The omission is mine.** I fixed this class in `test_common.rs` in round 494 and
did not grep for siblings, which is exactly the *fixes that were never
propagated* pattern this campaign has recorded against other people's work three
times. The remedy differing per site is the reason it is worth doing by hand
rather than by sed.

## Round 504 — 119 unbounded receives, fixed by one line that is not in any of them

Round 503 propagated the unbounded-receive fix through the SDK. This round took
it to the other repositories: **zero** in the server kernel, **119** in the
internal-service tests.

Fixing 119 sites by hand would mean 119 guesses at a per-site budget, each a
chance to bound something legitimately slow. The better question was what makes
a hang unreadable there at all.

**No safety net existed.** nextest's default `slow-timeout` only WARNS at 60s and
never terminates, and not one of those 280 tests carries an rstest `#[timeout]`.
Citadel-Protocol's suite is saved by those attributes; this one has none. A
single hung test therefore ran until the CI job's own timeout, and the failure
named the job rather than the test.

One config line — `slow-timeout = { period = "60s", terminate-after = 3 }` —
bounds all 280. The margin is deliberate: the slowest test here is ~6s locally,
so 180s is thirty times the real workload, and a test approaching it is a test
worth looking at.

Control: a planted `futures::future::pending()` test is TERMINATED and named,
where before it would have consumed the job.

**Where it was deliberately NOT applied.** Citadel-Protocol already has rstest
timeouts on 32 of ~38 tests, and its slowest legitimate test runs **97.7s** in
CI. Any global bound there would sit close enough to real work that a degraded
runner could turn a slow pass into a failure — manufacturing flakiness while
claiming to remove it. Coverage is good and the margin is thin, so the gap is
not worth closing that way.

**The generalisable bit.** Three rounds of this class produced three different
remedies: resend (mutual exchange), bound-and-report (counted echo), and
terminate-at-the-runner (no per-test net at all). The class identifies where to
look; it does not tell you what to do when you get there.

## Round 505 — do the campaign's fixes still exist?

Two incidents this session destroyed or nearly destroyed committed work: a
`git checkout --` that discarded an uncommitted fix along with the control it was
meant to revert, and a machine restart that landed mid-control with a
deliberately-broken edit in production code. Both were caught, but neither was
caught by design. So this round asked the question directly: **is every fix this
campaign recorded as done still in the tree?**

Twenty-four fixes probed across four repositories — the decline correlation, the
CID-scoped pruning, the rate-limiter ceiling and its raised cap, the three
authorization gates, both containment primitives, the scoped workspace creation,
the last-administrator guard, the path-component check, the `accept` field, the
UDP resend and grace, the group-broadcast bound, the `udp_media_modes` bounds,
the errno preservation, the one-shot diagnostics and its non-destructive init,
and the six gates.

**24 of 24 present.** Nothing was lost.

**One reported missing, and it was the probe that was wrong.** The rate-limiter
ceiling came back GONE because the needle I wrote for it — `administrators <= 1`
— is the LAST-ADMIN guard's string, pasted from the row above. The ceiling is
`if map.len() >= self.max_tracked_cids { return false; }` and sits at line 184,
with 13/13 of its tests passing.

That is the second false negative from a bad probe this session; the first was a
grep that missed a fix because `cargo fmt` had split the line across the pattern.
Both would have had me "correct" something already correct.

**The rule that follows.** A verification probe is a check, and checks need
controls in both directions: one that never matches reports a present fix as
missing, one that always matches reports a missing fix as present. The campaign
has spent nine rounds on controls that measured nothing; the probes doing the
measuring were never held to the same standard.

## Round 506 — the open list, reconciled

With #292 at 37 green and about to merge, this reconciles what the record still
calls open against what is actually true.

| recorded open | status now |
|---|---|
| `get_workspace` membership-gated, not permission-gated (LOW) | **still open** — a deliberate scoping choice, not a defect |
| Round 488: the UDP one-shot flake | **still open** — cause unidentified; diagnostics armed and proven to fire under CI's log level |
| Round 482: `ensure_messenger_open` returns `false` for two states | **CLOSED this round** — see below |
| Round 502: what causes the group-broadcast shortfall | **still open** — now bounded and self-describing rather than a silent 90s hang |
| PSK downgrade (upstream) | **still open** — reproduction and behaviour table recorded, not a lockout |

**Round 482 is closed, and it is worth saying how.** It was recorded as open
because the ambiguity lives in the WASM binding, and round 497 proved that
deferral right: the artefact is tracked, CI does not rebuild it, so a source
change there would not run. The question never asked was what is fixable at the
layer that *can* be changed and verified. The open completes in milliseconds, so
one bounded retry in the send path turns a spurious user-visible failure into a
slightly slower success — without touching the binding at all.

Three of the four remaining are the same shape: **a cause not yet identified,
with instrumentation in place to identify it.** That is a weaker position than
"fixed" and a much stronger one than "flaky", and the difference is that the next
occurrence produces evidence instead of a shrug. Round 494's cause was found
exactly that way.

The fourth is a scoping decision recorded as LOW and left alone deliberately.

Nothing recorded as open is a critical, high, or medium defect in shipped
behaviour.

## Round 507 — the last open LOW was reachable after all

The record carried one remaining LOW: `get_workspace` gated on membership alone,
banning changes only a role, so a banned account went on reading the workspace
name, description, metadata and office list. It was left alone on the grounds
that **"ban is not a wired feature (no operation, no gate)"**.

That justification had expired. `update_workspace_member_role` takes any
`UserRole`, and the grant-containment added in round 490 *permits* `Banned` —
its permission set is empty, so it is a subset of everything any grantor holds.
Setting a role to Banned is therefore an ordinary operation, and the gap was
reachable rather than hypothetical. The severity was wrong because the
reachability had changed underneath the entry.

`get_workspace` now also requires `ViewContent`. Asked as the permission rather
than as `role != Banned`, for the reason `remove_user_from_domain` records: what
`GetUserPermissions` reports must be what enforcement allows. `for_role` gives
Banned nothing and gives Guest `ViewContent`, so the refusal and the grant are
the permission editor's own answer rather than a second opinion.

**Three tests, and two of them exist to stop the fix being too broad.** A Guest
must still read (ViewContent and nothing else), and a non-member must still be
refused for being a non-member — a gate that refused everyone would satisfy the
ban case alone. Control: removing it fails exactly the ban test.

307/307 server-kernel tests unchanged; 88 checks green.

**The pattern.** This is the fourth item this campaign has found where prose was
true when written and false later — but the first where the stale part was a
*severity*. A finding's rating depends on what is reachable, and reachability is
exactly what the last twenty rounds kept changing.

## Round 508 — group access audited clean, and a gate whose first draft was blind

With #292 merged, this round audited an area the campaign had not touched:
server-side group-chat authorization.

**It is correct, and completely so.** Five group request variants exist on the
wire, all five are handled, and all five ask the right gate — `SendGroupMessage`,
`EditGroupMessage` and `DeleteGroupMessage` ask `authorize_group_write`
(`SendMessages`), `GetGroupMessages` and `GetThreadMessages` ask
`authorize_group_read` (`ViewContent`). An unknown channel is denied rather than
treated as public. Nothing to fix.

That correctness was won by hand, in five places, after every one of those
handlers — including the three that write — once asked the READ question, so a
Guest could post into, edit and delete chat in every room it could see. Nothing
held that fix in place.

**The index earned itself.** Checking for an existing guard first turned up
`check-group-permissions-are-enforced.mjs`, which sounds like the same thing and
is not: it governs the UI's client-side role editor. Four rounds ago that would
have been a fifth duplicate; this time it took one grep.

**The gate's first draft did not work, and its own control said so.** Removing a
handler's gate call left the check green, because the pattern matched the
`use crate::kernel::group_access::{authorize_group_write, ...}` import on the
line above. A handler that imported the gate and never called it would have
passed. It now requires the call — `authorize_group_write(` — and skips `use`
lines.

That is the eighth control this campaign has run that found the checker rather
than the code, and the second where the checker was mine and minutes old.

## Round 509 — the dpkg lock, and two blocks that hid behind argument order

#79's `test:crud` failed all three `playwright install` attempts. Not a download
failure, and the log says so exactly:

    E: Could not get lock /var/lib/dpkg/lock-frontend.
       It is held by process 2923 (apt-get)
    Error: Installation process exited with code: 100

`--with-deps` shells out to apt-get, and the runner image's unattended-upgrades
holds that lock for minutes after boot.

**The retry was the right instinct with the wrong shape.** It backs off 30s then
45s and re-attempts into a lock that is still held, so all three attempts die
identically. Seventy-five seconds of guessing never covers a multi-minute hold.
The wait needed is *until the lock is free*, not an estimate of how long that
takes.

**Two of six blocks hid from the first pass.** They spell the arguments
`--with-deps chromium` rather than `chromium --with-deps`, so a text anchor
matched four of six and reported success — a partial fix that would have left a
different job red and read as a new flake. There is a gate requiring these be
bounded *precisely because this class of fix failed to propagate once before*,
and argument order is how it nearly escaped again.

What caught it was checking the **property at every site** rather than
pattern-matching the shape I happened to write first: for each
`until timeout 600 npx playwright install`, is there a wait in the lines above?
That is a different question from "does my anchor match", and only the first one
is the thing I actually care about.

**Propagated, and labelled as preventive.** Six `sudo apt-get clean` steps run
under `bash -e`, so a lock failure there kills a disk-cleanup step and with it
the job, reporting nothing about locks. No run has failed that way; the mechanism
is simply the one just proven live one step above, and a best-effort cleanup
should not be able to fail a build. Recorded as preventive rather than dressed up
as a finding.

**And my own patch measured nothing, twice.** Both edits reported zero
replacements on the first attempt because the anchor's indentation was wrong.
Caught both times only because the script prints what it changed — the habit this
campaign keeps being saved by.

## Round 510 — opening a document broadcast the whole document

Audited the Yjs live-document path, which the original plan flagged as a possible
echo loop. **There is no loop**: the provider's update handler already ignores
`remote`, `merkle-reconstruct` and `creator-resync`, so a received update is
never re-broadcast.

The defect is one step away. `useDocumentPersistence` applies the stored state to
the **same Y.Doc the editor uses** — the doc the provider is attached to — and
that apply carried **no origin**. So the provider saw a local edit and pushed the
entire document at the peer every time an editor mounted.

Correctness was never at risk; Yjs converges. What it cost is a full-state send
on every open, competing with the keystrokes the same channel carries — and the
handler's own comment says that channel is overrun by one message per keystroke.
Nothing is lost by not sending it: the initial sync exchanges state vectors and
asks for what the peer actually lacks.

**Two things about the fix are worth more than the fix.**

The first draft of the test carried its **own copy** of the provider's ignore
list. It passed, and it would have gone on passing while the provider changed
underneath it — a test asserting against a copy of the rule rather than the rule.
The predicate is now an exported `isLocalEdit` and the test imports it.

The origin string was then written as a literal in two modules. It now lives once,
beside `YjsOrigin`, because a literal in each is one rename away from this
broadcast returning with nothing to notice it.

Control: making the provider stop ignoring the restore fails the tagging test and
leaves the genuine-local-edit test green — a guard that ignored every origin
would have satisfied the first assertion while silencing real edits.

## Round 511 — are the gates themselves still measuring anything?

Ninety-two gates now run. This campaign has caught nine checks that measured
nothing — including two of its own, one minutes old — so the suite deserved the
question it keeps asking of everything else.

**Executed all 92 and read what each reported.** Two say "0" and both are
honest: `check-wire-fields-exist` reports `0 in the baseline`, which is its debt
count and not its subject count, and `check-ci-matrices-agree` reports
`47 integration legs (0 additional)`. **No gate is currently vacuous.**

**What that does and does not establish.** It shows every gate has live subjects
today. It does not show each gate's predicate is right — `check-group-handlers-
are-authorized` had subjects and a wrong predicate an hour ago, matching the
`use` import rather than the call, and would have passed this audit. Having
something to measure and measuring the right thing are different properties, and
only the second needs a control.

**A latent risk, recorded not fixed.** Roughly half the gates have no explicit
"found nothing → fail" guard. Today that costs nothing because every one has
subjects; it matters the day a directory moves or a pattern goes stale, when a
guard would report safety it never measured. Mass-adding guards on a crude regex
would be speculative — several of the 49 scan a single fixed file where "nothing
found" cannot arise — so this is a note about where to look, not a work item.

**Also this round.** The call path was audited for the campaign's top defect
class and is clean: no unbounded awaits, deadlines and liveness already modelled,
and the annotation rate limiter genuinely wired into both `annotation-signal` and
`call-manager`. Nothing to fix, said plainly.

## Round 512 — round 510's fix was wrong, and the accidental broadcast was load-bearing

Applied this campaign's most productive lens — *what did the last change make
unreachable?* — to my own round 510, and it does not survive it.

Round 510 stopped a restore-from-storage being broadcast to the peer. The
reasoning was sound as far as it went: the apply was untagged, the provider read
it as a local edit, and every editor mount pushed a full document over a channel
the provider's own comment says one message per keystroke overruns.

**What it did not ask is what else carried that content.** Nothing does:

- `handleSyncStep1` sends the peer what THEY lack only when THEY send step1,
  and that happens at their construction — before our asynchronous load from
  storage lands.
- The step1 retry in the ack sweep runs only while `!initialSyncComplete`.
- The periodic `hash_check` was removed as a never-initiated protocol, so
  divergence is noticed when a message is exchanged and not otherwise.

So with the restore suppressed, an edit made offline reaches the peer **on the
next keystroke and not before** — and never at all for someone who reads a
document without typing in it. The accidental broadcast was load-bearing, and
one message per mount against losing an offline edit is not a close call.

Reversed. **Kept** from round 510, because those parts were right: the origin is
tagged, so the decision is now explicit rather than incidental; the ignore rule
is an exported `isLocalEdit` the tests assert against rather than copy; and the
origin string has one definition instead of two literals.

**The pattern this makes, and it is not a happy one.** Rounds 485, 494, 497 and
510 were all my fixes that a later round found wrong or incomplete — a lockout,
a 90-second hang, an inert source change, and now a lost offline edit. Every one
was caught by asking what the fix made reachable or unreachable, and not one by
the tests I wrote at the time, which passed in both worlds. An efficiency
argument is especially dangerous here: it is easy to measure what a change
removes and easy to miss what it was quietly providing.

## Round 513 — a Fable fleet on the whole stack, and a read-only round while it runs

The user asked for Fable 5.1 to run robustness, correctness and performance
checks across the stack, with ultracode. Launched an eight-dimension audit —
kernel concurrency, kernel authorization, internal-service lifecycle, UI state
and effects, UI data integrity, protocol correctness, SDK API hazards, and
performance hot paths — each piped straight into **adversarial verification**, so
a finding reaches the record only after another agent has tried to kill it.

Three things went into every prompt because they decide whether the output is
useful or noise:

- **The constraints, in full, to every agent.** No writing git commands, no
  tilt/docker, no integration or Playwright suites (they share one backend), and
  never build `citadel-workspace-internal-service` because its build script
  regenerates committed WASM. Subagents do not inherit caution.
- **A high bar with named exclusions.** File:line, a concrete failure scenario,
  AND why existing guards do not already cover it — with instructions to grep for
  the guard first, and a list of what was recently fixed, so this campaign's own
  work does not come back as findings. Each is told an empty list is a good
  answer.
- **Verifiers default to refuted.** On a codebase audited this hard, a false
  finding costs more than a missed one.

**While it runs, a read-only round.** Audited CI for the "check that cannot fail"
class, which nothing else covers: no `continue-on-error` anywhere, and every
`|| true` is either a cleanup or the `grep -c` idiom for tolerating zero matches.
The one that looked wrong — `diff <(...) <(...) || true` — is a print immediately
followed by `exit 1`, with the real comparison a string test and an explicit
emptiness check above it whose comment names the exact failure mode: *"a guard
that passes precisely when it cannot see anything"*. Nothing to fix.

Deliberately did **not** pursue the notification-store growth question: an agent
is auditing that exact dimension, and racing it duplicates the work.

## Round 514 — production deployment configuration, audited clean

Another dimension the Fable fleet does not cover: it is auditing product code, so
nothing in it looks at how the thing is actually deployed.

`docker-compose.production.yml`, all four services:

| property | server | internal-service | ui | cloudflared |
|---|---|---|---|---|
| `restart: unless-stopped` | yes | yes | yes | yes |
| healthcheck | yes | yes | yes | yes |
| CPU limit | 2.0 | 2.0 | 0.5 | 0.5 |
| **memory limit** | 2G | 2G | 256M | 256M |
| logging | yes | yes | yes | yes |

The memory limits matter more than usual here: this campaign found three
unbounded collections (kernel maps keyed by CID, the rate limiter's bucket map,
pending peer signals). An unbounded map inside a container with a hard memory
cap fails loudly and restarts; the same map with no cap takes the host down. The
caps are the reason those defects were survivable in production rather than
fatal.

The healthchecks are weak but not vacuous. `nc -z 127.0.0.1 12349` proves a port
is listening, not that the protocol behind it is answering — but it cannot pass
while the process is dead, which is the property that matters for `restart:
unless-stopped`. Worth noting it is also the source of the periodic "Handshake
not finished" lines in the internal-service log: the probe opens a TCP connection
and drops it. Noise, not a defect, and the log is easier to read once you know
that.

Nothing to fix.

## Round 515 — the ban gate reached one of four readers; removing an Owner revoked nothing

Two findings from the Fable fleet, and both are the same shape as the pattern
`fixes-that-were-never-propagated` was written for: a correct fix, applied in
one of the places it belonged.

### The ban gate

Round 507 taught `get_workspace` to require `ViewContent`, because banning
changes a ROLE and leaves `workspace.members` untouched — so a membership-only
gate kept admitting a banned account. Its siblings were never told:

| reader | gate before | what it returned to a banned account |
|---|---|---|
| `get_workspace` | ViewContent (round 507) | — refused |
| `get_node` | `is_member_of_domain` only | any node, `mdx_content` included |
| `list_nodes` | `is_member_of_domain` only | **every** office and room |
| `get_tree_structure` | `is_member_of_domain` only | the whole tree |
| `ListMembers` | `is_admin \|\| is_member` | every `User` record: roles, permission maps |

`is_member_of_domain` for a workspace id is literally
`workspace.members.contains(user_id)` — role is never consulted. `DomainNode`
carries `mdx_content`, `members` and `children`, so `ListNodes { parent_id: None }`
returned exactly what the round-507 gate was added to withhold, and more of it.
Meanwhile `GetUserPermissions` reported that the same account could view nothing.

Fixed with one `ensure_may_view_workspace` helper (membership AND `ViewContent`)
at the three node readers, and the same permission added to the non-admin half of
the `ListMembers` gate. Asked as the permission rather than as `role != Banned`,
for the reason round 507 records: what the permission editor reports must be what
enforcement allows. `for_role` gives Banned nothing and gives Guest `ViewContent`.

`a_banned_member_cannot_read_the_tree.rs` — three tests. The control removed the
`ViewContent` clause from the helper and the failure named its own scope:

```
banning left the member list untouched, so these reads still admitted them:
  ["get_node", "list_nodes", "get_tree_structure"]
```

`get_workspace` is absent from that list, which is the round-507 gate still
holding on its own — the control demonstrates the propagation, not the gate.

### Removing an Owner

`remove_user_from_domain` drops the role as well as the membership, and its
comment says why: `is_admin` reads the GLOBAL `user.role` and never consults the
member list, so a removed administrator keeps passing every gate while
`ensure_not_last_admin` can no longer see them.

The check was `removed.role == UserRole::Admin`, written when Admin was the only
role that gated anything. `is_admin_or_owner` later became the whole gate on
`update_workspace_member_role`, `update_member_permissions` and UpdateTreeSchema,
and `ensure_not_last_admin` grew to count Owner — its own doc says *"once the
Owner gained that gate, the guard had to follow"*. This demotion did not follow.
Removing an Owner was a no-op on their authority; removing an Admin, the case the
block was written for, worked.

Not an escalation — the Owner gains nothing they did not already hold. A
revocation that revoked nothing. Widened to `matches!(role, Admin | Owner)`.

`removal_takes_the_role_from_an_owner_too.rs` — three tests. The control reverted
to `== UserRole::Admin`; the Owner test went red and the Admin test stayed green,
which is what distinguishes a widening from a rewrite. The third test holds the
scope: removing a Guest leaves them a Guest, not silently a Member.

95 unit + all integration tests pass, clippy clean.

## Round 516 — a group message cost every recipient three parses of every document

`authorize_group_read` runs inside every connection's own receive loop, once per
`BroadcastAudience::Group` message, for every connected client. Each run walks:

| step | calls |
|---|---|
| `resolve_group_node` | `get_all_nodes` |
| `check_entity_permission` | `get_user` ×2, then `get_all_nodes` |
| `is_member_of_domain` | `get_workspace`, `get_all_nodes` |

`get_all_nodes` `serde_json`-parses the single `citadel_workspace.nodes` blob,
and a `DomainNode` carries its `mdx_content` inline — so that blob is *every
document in the workspace*. One message to a room of C clients cost 3·C full
parses of it. At 1 MB of nodes and 50 clients that is on the order of a
CPU-second per message, paid inside each connection's receive loop, so a client's
own requests stall behind other people's chat and its broadcast receiver falls
behind a channel with a capacity of 100. `RecvError::Lagged` only warns, and
there is no resync — so the lagged client silently loses notifications.

Round 508's open finding rated broadcast lag unreachable because structural
broadcasts are "human-paced". Group chat now shares that channel and does not
satisfy the assumption.

Fixed with `get_all_nodes_shared`, returning an `Arc` from a cache validated by
comparing the raw bytes. Three properties, deliberately:

- **`Arc`, not a clone.** The three calls per recipient now share one allocation
  as well as one parse. Mutators keep `get_all_nodes`, which clones.
- **Bytes, not a hash or a TTL.** This gates authorization. An entry that is
  stale for even a moment is a removed member still reading a room. A memcmp is
  exact, has no collision to reason about, and is still an order of magnitude
  cheaper than the parse it replaces.
- **The blob is still fetched every time.** Only the parse and the allocation are
  skipped. Nothing here assumes this process is the only writer.

Five tests, and the two controls fail on disjoint sets, which is the point:
disabling the cache fails only `unchanged_nodes_are_parsed_once_and_shared`;
never revalidating it fails only the three freshness tests — a changed tree, a
removed node, and a same-shape edit that a length or count check would miss.
`mutators_still_get_an_owned_map` stays green under both, holding the scope.

75 test binaries green, clippy clean.

## Round 517 — one busy room throttled chat for the whole server

`store_group_message`, `update_group_message`, `delete_group_message` and
`delete_all_group_messages` all took **one** mutex, shared across every group.
The field's own comment invited the change:

> A single mutex serializes across *all* groups (rather than per-group-id)
> because the cost is small (group message ops are infrequent compared to index
> ops) ... Refactor to a per-id mutex if profiling shows contention.

Both premises had expired. Group message ops are chat, not an occasional
administrative write. And the cost held under the guard is not small: a full
parse and re-serialise of the room's entire history, plus `backend_save`'s
100/200/400 ms retry sleeps, which happen *inside* the lock.

Now keyed by group id, which is the granularity the invariant needed all along —
the lock protects a read-modify-write of `group_messages:{group_id}`, and two
groups share nothing.

### The half that goes wrong

Splitting a lock is easy. The map that holds the locks is an unbounded
collection keyed by user-supplied data, which is the same shape this campaign
has already had to close three times (kernel CID maps, the rate limiter's
buckets, pending peer signals).

Pruned on acquire, by the only rule that is safe: an `Arc` with a strong count of
1 is held by the map alone, so nobody is inside it or waiting on it and dropping
it cannot break mutual exclusion for anyone. That bounds the map by
*concurrently active* groups rather than by every group that has ever received a
message. `MAX_TRACKED_GROUP_LOCKS` is the ceiling if even that grows, and the
fallback there shares a lock — degrading throughput rather than memory, which is
the right way round.

Five tests, three controls, and each control fails a disjoint set:

| control | fails |
|---|---|
| one lock for all groups | `two_groups_do_not_share_a_lock`, `concurrent_sends_to_different_rooms_do_not_serialise` |
| prune everything, in-use included | `a_lock_in_use_is_never_pruned` |
| never prune | `idle_groups_do_not_accumulate_locks` |

`one_group_always_gets_the_same_lock` stays green under all three — it holds the
original invariant, and would go red only if the split broke the thing the lock
was for.

### Still open: the O(history) rewrite

Not fixed. Every send still parses and re-serialises the room's whole message
list, because all of a room's messages live under one key. A 10k-message room at
~300 B each is ~3 MB parsed and ~3 MB written per message — and on the filesystem
backend that write is amplified again by the account-file rewrite that PR #294
addresses only the avoidable part of.

The fix is paging — the shape the UI already uses for P2P
(`message-page-operations.ts`): messages in fixed-size pages plus a metadata
record, so a send appends to the last page. That is an on-disk format change with
a migration, not a patch, and it is recorded here rather than attempted
mid-campaign. The per-group lock above bounds the *blast radius* of the cost to
the room paying it; it does not reduce the cost.

## Round 518 — three read-modify-writes outside the lock every other writer takes

The same mechanism in three places, all LOW, all the shape
`fixes-that-were-never-propagated` describes.

| site | the window |
|---|---|
| `async_kernel.rs` connect path | `get_user` → `insert_user` ran BEFORE `lock_workspaces()` was taken. An admin granting U the Admin role at the moment U first connects could be silently reverted to Member, both callers reporting success. |
| `delete_workspace` | `remove_workspace` ran outside every lock. A concurrent writer that had already read the workspace under the lock wrote its copy back afterwards and **resurrected** it — with the password key genuinely gone, so it can never be deleted again. |
| `add_user_to_domain` | membership under one acquisition, role under another. A removal landing in the gap left a non-member holding an administrative role: `is_admin` honours it (global role, never consults membership), `ensure_not_last_admin` cannot see it (counts admins among `workspace.members`). |

The third needed `write_user_role` split into a locking wrapper and a
`write_user_role_locked` body, because `tokio::sync::Mutex` is not reentrant —
calling the guarded writer while holding the guard would deadlock, which is
exactly the trap a caller reaching for atomicity falls into.

### The split broke the gates, and the control found what the fix opened

`last_admin_race_test.rs` scans the source and asserts every role write and every
`insert_user` sits in a function that mentions `lock_workspaces()`. A `_locked`
helper does not, by design — so three gates went red.

Widening them is where this could have gone quietly wrong. The exemption is
paid for: `every_locked_helper_is_called_under_the_lock` checks the other half,
that every call site of a `_locked` helper is itself under the lock. Without that
pair the suffix would be a way to opt out of the guarantee the file exists to
enforce.

Then the control on the widened gate said something worse. Reintroducing the
defect as `drop(_workspace_guard); write_user_role(...)` left **all five tests
green** — because they look for `lock_workspaces()` anywhere in the enclosing
function and cannot see whether the guard is still live at the write. That hole
predates this round, but the split created a natural way to fall into it. So
`no_workspace_guard_is_released_early` bans the shape outright, and it now fails
that control by name and line.

Two controls, disjoint: the early-drop fails only the new test; removing the
guard entirely fails only `every_locked_helper_is_called_under_the_lock`.

100 lib tests and every integration binary green, clippy clean.

## Round 519 — the last three LOWs: a forget that was not a disconnect, a decline that read as a yes, a card nobody could take down

### `DisconnectOrphan` removed the entry and told the SDK nothing

Nothing in `Connection` tears the protocol session down when it drops — the only
`Drop` impls are on the receive halves, and the C2S receive half is not in
`Connection` at all; it lives in the task the connect handler spawned and keeps
running. So the handler answered *"Disconnected orphan session X"* while a
`SessionState::Connected` session carried on with its keepalives.

The account was then wedged until the process restarted: with the map entry gone
the next `Connect` calls `remote.connect()` and the protocol refuses it;
`ClaimSession` and `Disconnect` both answer "not found". No wire command could
reach the session that was still there.

`peer/disconnect.rs` has always awaited `disconnect_removed` for the same
removal. Propagated to the two branches that never got it.

The test asserts the **consequence** — that the account can reconnect — because a
handler that removes an entry and reports success passes any assertion about the
message it just wrote. The existing bulk test does exactly that, and stayed green
through the whole defect. The control fails with the protocol's own words:
`Session for CID ... already exists. Disconnect first before reconnecting.`

### `register_to_peer` returned `Ok` for a decline

Correct as a contract — the round trip succeeded, the answer was no. But
`PeerRegisterStatus` derived nothing: no `Debug`, no `PartialEq`. A caller could
neither compare it nor log it, so `Ok(_)` was the only thing left to write, and
all three real callers wrote it. `peer_connection.rs` then logged *"success ->
now connecting"* and sent a PostConnect to a peer that had refused, waiting out a
60s `RemoteP2pConnectTimeout` and reporting that instead.

The derives are the fix for the type; `is_accepted` and `refusal_reason` are the
fix for the call sites, which needed something shorter to write than the mistake.

### A notification nothing could remove

With auto-accept on, both consumers of one `PeerRegisterNotification` run: the
store records the request and raises a HIGH card, while
`p2p-registration-service` accepts it and removes only the pending entry.
`removeNotification` is reachable only from the notification UI itself, so no
code path could clear the card — an unread "X wants to connect" with live Accept
and Decline for a request already accepted.

Keyed on the REQUEST id, not the peer's CID. Clearing by peer would take down a
second, genuinely pending request from someone just accepted — the plausible
version of this fix, and the third test exists to fail it. It does.

The 250-line gate caught both new modules before I did.

## Campaign status

All 18 confirmed Fable findings are addressed. Two are merged to
Citadel-Protocol master (#293 CRITICAL, #294 HIGH). The rest are on #295 and #79.

Open, recorded rather than fixed:

- **`store_group_message` is O(history) per message.** All of a room's messages
  live under one key, so every send parses and re-serialises the lot. The fix is
  paging — the shape the UI already uses for P2P — which is an on-disk format
  change with a migration. Round 517 bounded the blast radius to the room paying
  it; it did not reduce the cost.
- **Byte-map write amplification.** #294 removed the avoidable multiple (a read
  that wrote, three mutations that mutated nothing); persisting one key still
  serialises every key for that CID. Same reason: the format.

## Round 520 — a second Fable fleet, pointed at this campaign's own diff

78 agents over the net diff of #79 and #295, six dimensions, each finding then
attacked by three adversarial lenses. **24 raised, 12 survived, 12 refuted.**

The single most useful finding was against round 517, written four rounds
earlier in this same campaign.

### The bound I added had a saturation case, and the saturation case was the bug

Round 517 replaced one global group-message mutex with a map keyed by group id,
pruned by `Arc::strong_count`, capped at 4096, with a fallback that shared an
existing lock when full. The fallback **did not record which group it had been
handed to.** So the next caller for that group missed the map, found room freed
by the prune, and minted a *fresh* mutex — while the first writer still held the
shared one. Two concurrent read-modify-writes on one room's history, and the
second save silently drops a message: exactly the lost update the mutex exists to
prevent, restored by the code written to bound it.

`HashMap::values().next()` is also not stable across mutation, so two callers
both taking the fallback could get different locks.

Reachability is poor — 4096 distinct groups mid-write at one instant, against a
100 req/s per-CID cap — and two of three verifiers said so. That is not the
reason to fix it. The reason is that the fallback was written as the *safe*
degradation and was not one.

### Striping, not a patched map

The fix is not an `is_nil` check or a "also insert the shared lock" line. It is
to delete the map. A group's stripe is now a pure function of its id —
`hash(group_id) % 256` — so:

| property | map + prune + cap | striped |
|---|---|---|
| same group, same lock | until saturation | always, by construction |
| memory | bounded by active groups | fixed, 256 mutexes |
| saturation case | shares a lock it does not record | none exists |
| two groups collide | never | 1/256, costs throughput only |

There is no state to get wrong, which is a stronger claim than "the state is
handled correctly". The `MAX_TRACKED_GROUP_LOCKS` constant, the pruning rule, and
the three tests that guarded it are all gone with it.

Two controls, disjoint: a constant stripe (the single global lock, reinstated)
fails the three distribution and concurrency tests; a stripe that drifts under
load — the map version's actual failure — fails only
`one_group_always_gets_the_same_lock`, by name.

`the_stripe_function_distributes` exists because every other test in that module
passes with a constant stripe.

## Round 521 — four gates of mine that could not fail

The fleet's `tests-that-cannot-fail` dimension asked one question of every gate:
*name the one-line change that turns this red.* Four could not answer.

| gate | what it was actually measuring |
|---|---|
| `check-session-teardown-prunes-cid-state` | a spelling. It matched only the chained `map.write().remove(&cid)`; three real removals bind the guard to a local first, so it reported "all 5 sites prune" while three did not |
| `check-group-handlers-are-authorized` | *some* handler nearby asks. Its 40-line window ran past the end of the arm, so deleting one handler's gate could leave it green on its neighbour's |
| `check-admin-promotions-are-gated` | that the function *knows about* the gate. Any mention of a gate token in 60 raw lines counted, so `if outcome == Promote` could become `if true` and stay green on an earlier, unrelated test of the same condition |
| `check-wasm-matches-its-source` | whether somebody typed a hash. `sync-wasm-clients.sh` stamped `$DEST1` — untracked, inside the submodule — and never the tracked copy the gate reads |

Each is now measured, and each control is the exact mutation the fleet used:

- **Teardown**: the window counts CODE lines, so a comment explaining a prune no
  longer pushes it out of range — a gate that rewards silence is the wrong
  incentive. It now sees 8 sites, up from 5, and removing a prune at one of the
  three newly visible sites fails it.
- **Group handlers**: the window is cut at the next arm head. Deleting
  `GetGroupMessages`' gate block — green before — now fails.
- **Admin promotions**: the gate must CONTROL the assignment, established by
  brace depth: an enclosing conditional whose block is still open, or an
  `if <gate> { return }` guard clause. Neutering the guard *at* each promotion,
  leaving the decoy mentions intact, now fails both sites.
- **WASM**: the sync script stamps the tracked copy. Before, a genuine rebuild
  left the stamp unchanged and the gate failed telling you to run the script you
  had just run; the only way out was `echo <hash> >`, which is also how you would
  turn it green over a stale binary.

The WASM one is the sharpest. Its own header already claimed an honest limit
("cannot retroactively prove…") — and the limit it *had* was that the only way
to satisfy it was the same action that defeats it. A gate whose green state is
produced by hand is a gate that measures a hand.

Three of these four were written this campaign, by me, with controls that passed.
The controls were on the FIX; the gate itself was never mutated. That is the
habit this round adds: run the control against the gate, not only against the
code it guards.

## Round 522 — the ban stopped at the workspace root

Round 515 taught four readers to ask `ViewContent`. Round 518's `ListMembers`
gate asks it at the REQUESTED domain; `ensure_may_view_workspace` asks it at the
root. For an ordinary member those agree. For a banned one they did not.

`set_role_permissions` writes exactly one key. Banning a member rewrote
`permissions[WORKSPACE_ROOT_ID]` and left every per-node grant standing — and
`add_user_to_domain` writes one of those for each office or room the member is
added to, while `check_entity_permission` honours a direct grant BEFORE it
consults role or membership.

So a banned account kept `ViewContent` and `SendMessages` in every room it had
been added to: it could still read that room's roster, and still read **and post
in** its chat. The node readers refused the same account, because they ask at the
root. Two gates added one round apart, disagreeing about one user.

Revocation is scoped to roles whose permission set is empty — Banned, today —
rather than recomputing every domain on every role change. A per-domain grant can
also be set deliberately through `update_member_permissions`, and a promotion
must not silently redistribute authority. Revoking everything is what a ban
means; redistributing everything is not what a promotion means.

### The scope test did not measure its own scope

The first version demoted a member to Guest and asserted their office
`ViewContent` survived. It passed against a build that cleared every grant —
because Guest holds `ViewContent` by role, so `check_entity_permission`'s role
fallback answered true whether the direct grant survived or not.

A grant that merely matches the role's own table proves nothing about whether the
grant is still there. Rewritten to use `EditTreeStructure`, which no role below
Admin holds, so only the direct grant can answer for it. The too-wide control now
fails it by name.

That is the same mistake as round 520's, one level down: a control that passes
because something *else* covers for the thing being measured.

## Round 523 — the last open MEDIUM: a send stops rewriting the room

Every message in a room lived under one key as a single `Vec<GroupMessage>`, so
sending one parsed and re-serialised the whole history — a 10k-message room at
~300B each is ~3MB in and ~3MB out per send, amplified again on the filesystem
backend by the account-file rewrite. Round 517 gave each room its own lock, which
bounded the blast radius of that cost to the room paying it; it did not reduce
it, and the record said so.

Now paged. `…group_messages.{gid}.page.{n}` holds up to 256 messages,
`…group_messages.{gid}.pages` holds the count, and the pre-paging key is the
migration source.

| operation | before | after |
|---|---|---|
| send | whole history in and out | one page (+ the index when it rolls over) |
| send that is a reply | whole history | one page, plus the parent's page |
| edit / delete | whole history | the page holding it |
| full read | whole history | unchanged — callers ask for all of it |

Split SBIO: which page a message belongs to, how a legacy blob splits, and where
an id lives are pure functions in `group_message_pages`, testable with no
backend. The reads and writes stay in the manager. That split is what made the
migration testable at all.

**Reads never migrate.** A reader that migrated would race every other reader,
and `get_group_messages` runs on every history fetch. Migration happens on the
next write, under the group lock, and is idempotent — the index's presence is the
flag. The legacy blob is deleted only after every page and the index are written,
so a failure part-way leaves the room readable in its old form rather than half
in each.

### The headline test measured nothing, and a control said so

`a_send_writes_one_page_not_the_history` first asserted page 0's *contents* —
that it still held the first 256 messages, oldest first. It passed against a
build where every send rewrote the entire history, because splitting the whole
history back into pages produces an identical page 0. The result is the same; only
the cost differs, and a result assertion cannot see cost.

Rewritten to record which KEYS `backend_save` writes, via a `#[cfg(test)]`
counter. Then it caught my own expectation as well: page 2 is exactly full after
768 sends, so the next send correctly rolls over and writes the new page *and*
the index. It now asserts both cases — a rollover writes two keys, an ordinary
send writes one, and neither touches an older page.

### An existing test's fault target moved, and the property survived

`a_failed_history_purge_leaves_the_delete_retryable` faulted deletes of
`citadel_workspace.group_messages.chan-1` — the pre-paging blob, which the first
write now migrates away. Faulting it would fault a key holding nothing, and the
purge would succeed at removing every message before failing on an empty delete;
the assertion would have been measuring a purge that HAD happened.

Pointed at the page key instead. That is also what keeps the original property
true: `delete_all_group_messages` removes the pages first and the index last, so a
failure among the pages leaves the index pointing at everything still there —
nothing orphaned, history still readable, retry completes it. The test asserts the
same thing it always did.

Nothing above LOW is now open in either audit.

## Round 524 — two CI failures, and the difference between them

Both PRs went red on the same job name. They were nothing alike.

### One was mine, and the assertion was the bug

`rejections_reach_the_caller` asserted the caller receives *the server's* reason
for a refused registration. On ubuntu it received the backstop's generic one
instead — an error either way, and never a hang, but not the string the test
named.

Two answers are possible **by design**, and the commit that built the second one
said so: the final-reply flush is best-effort because the writer's channel has no
drain signal to await, and a peer that has hung up will never let the write
finish. I then wrote an assertion that pinned the race anyway.

The tempting repair was a longer grace. That hides it. It now asserts that one of
the two arrived — which the control shows is not toothless: with both layers
disabled the test still fails with *"the refused registration never returned"*.

Making the server's reason deterministic needs a drain signal on the outbound
sender's item type. Open, and named as open, rather than papered over with a
sleep.

### The other was not mine, and the discipline was not to fix it

`test_single_connection_transient::case_4` is the intermittent UDP one-shot
failure carried since round 488. Twelve local runs of the failing test passed, so
there is no reproduction here.

But the instrumentation added in #292 did its job. The failing run shows, in
order: the server's `[udp-oneshot] receiver: …no channel receiver at connect
STAGE0`, then two `udp_mode_assertions` — the first completing through AB2, the
second panicking at AB1. That pins the side: the SERVER had no receiver.

From a fresh `UdpChannelSender::default()` that is impossible. The only route
there is a re-entry of `handle_success_as_receiver` after `rx` was taken while
`tx` had not been: the guard `tx.is_none() && rx.is_none()` sees a half-consumed
pair, declines to reinstall, and every later connect on that session finds no
receiver.

The fix writes itself — key the guard on `rx` alone. **It was not made.** The
comment directly above that guard records a previous change in exactly this area
that made the receiver present when the hole punch had failed, turning a 1.4s
failure into a 90s hang. A speculative fix there, with no reproduction, trades a
visible flake for an invisible one.

So the hypothesised state is logged instead (PR #297). If the next occurrence
prints `[udp-oneshot] install: receiver already taken while the sender was not`,
the one-line fix has evidence behind it. If it does not, the hypothesis was
wrong and that is worth knowing too.

The pattern is the same one that got this far: #292's line is the only reason
today's failure was localisable at all.

### Round 523, postscript: the cost paging moves rather than removes

Checking whether `backend_delete` errors on a missing key (it does not — the
byte-map remove answers `Ok(None)`) surfaced something the round-523 entry did
not say: on the filesystem backend, every delete that actually removes something
rewrites the whole account file. So purging a 40-page room now costs 40 of those
where the single blob cost one.

That is the right trade — a room is deleted once in its life and written to on
every message — but it is a trade, and an entry that only listed the wins would
have been the kind of half-report this campaign keeps finding in other people's
work. It is now written at the call site too, so it is found by reading rather
than by measuring.

A batch delete in the backend would remove the cost entirely. There is no such
primitive today.

## Round 525 — three Fable agents on the flake, and two defects nobody was looking for

The user asked for three parallel agents on the intermittent UDP failure, one
architectural. Two have reported. **My hypothesis was wrong**, and the review
found two defects that are not test flakes at all.

### The mechanism, proved from the log rather than argued

`connect_packet.rs:74` gates connect STAGE0 on `pre_connect_state.success` alone.
The preconnect SUCCESS arm sets that from the PEER's packet
(`preconnect_packet.rs:436`), without waiting for this session's own hole punch —
and inbound packets are processed concurrently (`session.rs:1093`,
`try_for_each_concurrent(64)`). So connect STAGE0 can take a receiver that
`handle_success_as_receiver` has not installed yet.

The CI log settles it. In job 100054920908, lines 2037–2039:

```
Hole Punch Status: Ok(… 33b98969 …)      <- one side's punch resolves
[udp-oneshot] receiver: … no channel receiver at connect STAGE0
Hole Punch Status: Ok(… e3a7add7 …)      <- the SERVER's punch resolves, too late
```

The take is sandwiched between the two completions. Not a hypothesis.

It also explains the shape: the hole-punch **loser** returns as soon as it sends
`WinnerCanEnd` while the winner blocks, so the client is always installed — which
is the one-side-passes asymmetry in the log. And it explains why only the
transient test: transient accounts skip Argon at STAGE0
(`client_account.rs:276`), which is what makes the server fast enough to lose.
The review also found `case_3` failing identically in an earlier job, so the
server password in `case_4` was a red herring.

### Two defects that are not flakes

- **A production leak.** In the losing order the server's loader still installs
  and sends into the orphaned receiver, and `insert_udp_channel` builds an
  `unbounded()` channel (`channels.rs:67`). The orphan keeps it alive in the
  state container for the session's lifetime, so every client datagram
  accumulates unread while the loader logs success.
- **A live client-side hang.** On punch failure the client leaves the zero-state
  pair intact and only warns (`preconnect_packet.rs:669`); its `udp_mode` is
  never set to Disabled, so the take at `:332` returns a receiver nothing will
  ever send on. The "1.4s became a 90s hang" the install-site comment warns about
  is already shipping, on the client, for anyone behind an uncooperative NAT.

### The one-line fix is rejected, with a reason

Keying the install guard on `rx` alone does nothing here — the pair is `empty()`
at take time, so the guard already installs — and it reopens what #292 fixed:
between the connect take and the loader's `tx.take()`, the state is
`(tx Some, rx None)`, and any re-entry in that window would replace a live sender
and orphan the application's receiver.

### What is open, and what it needs

The fix is to order the server's BEGIN_CONNECT behind its own punch completion —
which `last_stage` already records, set on BOTH the success and the fallback
branch. Roughly 30 lines and one wait.

It is not made here, and the reason is a reproduction, not nerve: the review
named a deterministic one through the existing `PlatformOps` seam
(`platform_ops.rs:93`) — a test implementation whose `c2s_hole_punch` returns
~50ms late — with the control being that the warn fires before the change and
cannot after. That is worth building first, because twelve local runs proved
nothing and this area has already turned a 1.4s failure into a 90s hang once.

## Round 526 — the containers were not building what the repository says

`test:file-manager` went red on an unchanged branch. The comparison that found
it: **0** gate refusals and **0** ILM storage errors in the 19:04 run, **152** and
**2,060** in the 23:17 run of the same code.

The difference is not in this repository. `Cargo.toml:43` declares
`citadel_sdk = { git = ..., branch = "master" }`, the committed `Cargo.lock` pins
`da66b47c` — and **neither Dockerfile copies the lockfile**. So cargo re-resolves
the git dependency to master's TIP when the image is built. The failing run's
logs name `citadel-protocol-…/a90e75d`: PR #294, merged to the protocol repo at
21:33, between the two runs.

Three consequences, and the third is the one that matters:

1. The same workspace commit built twice can produce two different binaries.
2. The tested binary is not the one `Cargo.lock` describes.
3. **A regression merged to another repository arrives here with no change and no
   signal.** Nothing in this repo could have shown it; only a passing-vs-failing
   log comparison could.

And that is what happened. #294 skips a byte-map write when the value equals what
is already in memory — but memory is written before the file and never rolled
back, so a retry with identical bytes short-circuits to `Ok` without touching the
disk. `backend_save` (`transaction/mod.rs:317`) retries exactly that way, with
the same serialised bytes, three times. A node-map write that failed once was
acknowledged and silently lost, which is a folder deletion that never persisted
and a peer that keeps seeing the folder through three syncs.

PR #296 fixes that in the protocol repo. This round fixes why it could arrive
unannounced: both images now copy the lockfile, so upgrading the protocol becomes
an explicit commit that moves `Cargo.lock` rather than a side effect of somebody
else's merge.

`check-images-build-what-the-lockfile-says` guards it. The gate is the COPY, not
`--locked`: the server image builds from an alternate manifest and may
legitimately need to resolve dependencies the root lock does not carry, but
copying the lock pins the git revision either way.

### A gate refused to lie about a subject it could not find

The same commit tried to register `check-message-storage-has-one-owner`, written
for the paging branch. On this branch its subject does not exist, and its vacuity
guard failed the run rather than reporting "OK: 0 shapes checked". That is the
guard earning its place — every gate in this suite has one, and this is the first
time one has fired for real.

## Round 527 — thirty-four alerts nobody had counted

Every wave up to here reported "30 raised, 30 fixed, no critical/high/medium
remaining". That was true of what the two Fable fleets found by reading code. It
was **not** an answer to the question being asked, because nothing in this
campaign had looked at dependency advisories.

There were **34 open: 17 high, 14 medium, 8 low.** Several are reachable from
shipped code rather than from tooling:

- `quinn-proto` — **unauthenticated remote DoS via panic in QUIC**, plus remote
  memory exhaustion from unbounded buffering. Any peer that can send packets, in
  the transport this product's P2P path runs on.
- `openssl` ×5 — memory safety: a write past a caller-supplied buffer in
  `MdCtxRef::digest_final()`, overflow in `Deriver::derive`, UB in
  `X509Ref::ocsp_resp`, an unchecked callback length in the PSK/cookie
  trampolines, a bad bounds assertion in AES key wrap.
- `rustls-webpki` — panic on a malformed CRL.

Three fixes were already sitting green and unmerged (#78 `quinn-proto`, #77
`brace-expansion`, #76 `js-yaml`). Merging them cleared **six** highs, not three:
each bump closed several advisories against the same package. #81 and
citadel-internal-service#59 take `openssl` 0.10.75 → 0.10.79 and `rustls-webpki`
0.103.9 → 0.103.13 in both lockfiles — patch-level within the same minor, so no
API surface moves. Since round 526 both images COPY the lockfile, so this bump
reaches the built containers instead of stopping at the host build.

### Five highs deliberately not fixed

`minimatch` ×2 and `flatted` are transitive under `eslint` / `@typescript-eslint`
— lint tooling parsing our own source in CI. npm's advisory database does not yet
flag those versions, so neither `npm update` nor `npm audit fix` moves them; the
only mechanism is a manual `overrides` block. I tried it, and backed out: it
required deleting and re-resolving a tracked lockfile, and while attempting it I
(a) deleted `citadel-workspace-client-ts/package-lock.json` expecting
`npm install --package-lock-only` to regenerate it, which it did not, and
(b) silently stripped 430 lines from the ROOT lockfile — the package name and
every `@esbuild` platform entry — by running npm inside a workspace member.
Both were caught by diffing before staging and reverted. Neither reached a
commit. The churn was out of proportion to a ReDoS in a glob matcher that only
ever sees our own file paths.

`vite`'s fix is 6.4.3 against 5.4.21 installed — a major bump for a
`server.fs.deny` bypass affecting the dev server, not the static assets that
deploy. `extract-zip` has **no patched version at all**; it arrives via
`lighthouse` → `puppeteer-core` → `@puppeteer/browsers`, and the zip it extracts
is Chrome's own signed download.

Each is real; none is reachable from deployed code. Written into #81's
description so a lower alert count is not read as "handled".

## Round 528 — a draft proposing the approach master had already rejected

#281 ("external_ipv6 must actually be an IPv6 address") had one red job and I
opened it expecting that job to be the flake #302 fixes — planning to rebase and
merge. It was not. A previous session had diagnosed it as **deterministic**: two
failures on the branch, three greens on master.

The remedy that PR proposed in its own closing comment had since shipped as #282
(`dfdff3c2`), arrived at from the other side — keep the deliberately dual-stack
`[::]` bind and correct the advertised **candidate** to the IPv4-mapped internal
address, plus a Windows guard for where `[::]` binds IPv6-only. `routable_candidate`
now names this attempt directly as the branch not taken. Merging it would have
re-broken the test #282 exists to keep green.

Closed with that recorded, including the part still true: `external_ipv6` holds
an IPv4 address on IPv4-only hosts, and that field still doubles as the
dual-stack bind switch, so it cannot be corrected at the source until the two are
untangled.

## Round 529 — the one service in production that floats

`docker-compose.production.yml` argues at length for pinning and tells operators
to "pin an explicit SHA tag for a deploy you need to be able to reproduce
exactly" — and then ran `cloudflare/cloudflared:latest`.

`latest` is defensible for our own three images and the file explains why: CI
advances that tag only through a `promote-latest` job requiring every image in
the release to have built and passed its smoke test, and
`verify-image-revisions.sh` proves the pulled set came from one commit. No such
gate exists for a tag someone else controls. With `restart: unless-stopped`, a
host reboot following a registry pull swaps the process **terminating the public
tunnel**, with nobody choosing to and no record of which version had run.

Pinned as `${CLOUDFLARED_TAG:-2026.8.3}`.
`check-third-party-images-are-pinned` keeps it pinned, exempting
`ghcr.io/avarok-cybersecurity/*` and resolving `${VAR:-default}` so a pin
expressed through a variable counts.

Three controls, all run: the floating tag is caught, a tagless reference is
caught, and **removing the only third-party image fails rather than passing
vacuously**. The third is the one that earns its place — without it, deleting or
renaming the last third-party image would make the gate scan nothing and report
the same green as a gate that passed.

Scope is written into the gate's header: it checks the tag is not floating, NOT
that it is digest-pinned, so a publisher force-pushing a version tag still moves
the image underneath us. Digest pinning is strictly stronger and deliberately not
required, because operators edit these files by hand and a digest cannot be read
in review.

### Two audits that found nothing

`docker-compose.local.yml` — the stack every user runs on their own machine —
holds up: the agent has **no `ports:` block at all**, so the unauthenticated
control plane is never published; `INTERNAL_SERVICE_BIND_HOST=0.0.0.0` is the
container's interfaces, unreachable without a publish; the UI publishes as
`127.0.0.1:8080:8080` with a note that the left-hand address is load-bearing.
And the server's master password fails fast on both empty **and** the
`.env.example` placeholder. Recorded as negative results rather than left unsaid.

### Three assessments I got wrong

Worth more than the findings. I reported as broken or unassessed: four UI defects
(fabricated upload, no `ErrorBoundary`, two toast systems, no `ThemeProvider`),
deployment/ops entirely, and #281's red job. All three were wrong.

The UI claims came from `git show origin/master:...` **inside the submodule** —
whose own `origin/master` is a stale branch. The parent repo pins
`citadel-workspaces` at a much newer commit, where all four are fixed, and the
code documents the exact bugs I "found" as already corrected. Deploy/ops turned
out to be among the most carefully reasoned surfaces in the tree. #281's failure
was deterministic, not flaky.

The pattern is one mistake, not three: **asserting a state without checking the
revision that actually ships.** The merged work stands on CI evidence; the
assessments were the weak part, and a reader of this file should weight them
accordingly.

## Round 530 — the flake that froze releases for nine days

`member-promotion.spec.ts` was filed as a test annoyance. It is not. The
`Publish Images` workflow runs a full `Validate before publishing` gate, and
that gate fails on this one spec:

    Validate before publishing / Playwright - shard 2/3   FAILED
    Publish ${{ matrix.image }}                           skipped
    Promote latest                                        skipped

73 passed, 1 failed, 2 skipped. The two skipped jobs are the ones that build
and tag images. So **no image has been published since 25 August** and `latest`
still points at week-old code; the newest tag in GHCR is `sha-aeafb7ec`, a
commit behind master. A deployment today would ship code predating the
CRITICAL auth-bypass fix, the openssl bump and the paging work.

It has now failed this gate on `aeafb7e`, `af5481a`, `8c711fa` and `af2e64f`.
Earlier rounds called it "intermittent, passes most runs"; against the publish
gate it fails more often than it passes.

The spec fails on its BASELINE -- a plain member's Edit button reads enabled --
and the instrument built for exactly that condition,
`logOfferedWithoutAnswer`'s "edit offered without an answer", reached no
artifact the run produced: not the job log (container output, not page
console), not the fixture (no console listener), and not the trace, whose
event types were `before`/`after`/`stdout`/`context-options`/`error` with zero
console entries. Rounds 531-532 put that diagnostic where the failure happens.

## Round 531 — six CI rungs, each hiding the next

Landing the diagnostic in the UI repo took six fixes, because that repo's own
workflow had a stack of failures where each one masked the one below:

| # | Cause | Whose |
|---|---|---|
| 1 | `Pull base images` used a step-level `working-directory` relative to the WORKSPACE ROOT, not the job's `defaults.run.working-directory: parent` | pre-existing |
| 2 | `vite build` could not resolve the wasm-pack glue: the production-bundle gates were copied from the parent without the `sync-wasm-client` step that generates their input | pre-existing |
| 3 | `EACCES` on `dist/sw.js.map`: the sync container runs as root and leaves `dist/` root-owned | pre-existing |
| 4 | my reclaim step removed `parent/parent/...` -- `rm -rf` on a missing path exits 0, so it went green having done nothing | mine |
| 5 | `multi-user.fixture.ts` hit 269 lines | mine |
| 6 | the repo carried its own drifted copy of the 250-line rule | pre-existing |

Rung 4 is the one worth keeping. I wrote it one commit after diagnosing rung 1,
in the same file, and got the direction backwards: a step's `run:` is relative
to the job default, a step-level `working-directory:` is relative to the
workspace root. Those are opposite. The step now verifies the directory is
actually gone -- a cleanup that cannot fail reports a success it has not
earned, which is the same defect as a gate that cannot fail.

Rung 6 is the other: two implementations of one rule had drifted, and the
parent's was the stricter (it pins each exception to an EXACT line count, so a
held file cannot quietly grow). **Two implementations of one rule drift toward
the weaker one.** Replaced with a delegation; 45 lines of duplicate deleted.

### A pointer bump that would have reverted 109 commits

Routine-looking submodule work. `git diff --submodule=log` showed six `<`
lines -- commits being REMOVED -- for `citadel-internal-service`. The parent
pins `e21933c`, which lives on `origin/audio-video-support`; that repository's
own `master` is **109 commits behind it**. Moving the pointer to `master` would
have reverted session-ownership fixes, the WebSocket origin allowlist, media
transport and the whole ILM series.

Consequence still open: **PR #59's openssl bump merged into that stale
`master`**, so the submodule's lockfile fix is not in the line the parent pins.
Which branch is canonical there is a decision, not a commit.

## Round 532 — onboarding that costs the test suite nothing

There was no onboarding at all: no tour component, no tour dependency, no
first-run detection, no "seen intro" flag. The survey that established this
also produced the number that shaped the design -- account creation costs **9
UI interactions** (11 for the first user, who also initialises the workspace)
across two full page loads, and the suite creates an account for nearly every
spec, roughly 90 per run.

So the gate is the INVERSE of `isDiagnosticsUiEnabled`: off in development, on
in production. Diagnostics are for us and hidden from users; onboarding is for
users and hidden from us.

What it fixes is specific, not decorative. "Create Account" against a bare
address does two different jobs -- the first person becomes administrator and
needs `WORKSPACE_MASTER_PASSWORD`; everyone after is joining and cannot hold
it. Today that secret is first named in a modal shown AFTER the account exists,
including to members who have no way to obtain it. `OnboardingIntent` names
both paths before the wizard, and deliberately does not branch registration.

One thing the diagnostics gate does not have: an explicit `?onboarding=0` that
beats production. Without it, testing onboarding against a production build
would make every fixture account pay for the dialog too.

Controls, and what each proved:

- unit: inverting the environment default fails 3 assertions; removing the
  off-switch fails 2; treating a storage throw as an opt-out fails 1. The last
  is unreachable from any dev-only test -- partitioned storage would otherwise
  make onboarding vanish in production.
- Playwright, run live: 5 passed. Forcing the gate off fails 4 and passes
  exactly one -- "is absent in the environment the suite runs in". A control
  that failed all five would have discriminated less.

### The dev stack was broken, in three layers

The UI container was crash-looping on `Cannot find package 'vite-plugin-pwa'`,
a dependency declared at `citadel-workspaces/package.json:119`.

1. `package.json` is **baked into the image** (`docker/ui/Dockerfile:7`), not
   bind-mounted. A dependency added to the repo never reaches a running
   container.
2. Running `npm install` inside the container made it worse: it pruned 164
   packages to match the stale manifest.
3. Rebuilding the image did not help either -- the named volume
   `citadel-workspace_ui_node_modules` SHADOWS `/app/node_modules`.

Fixed by removing the volume and recreating. Worth stating as a standing trap:
a dependency added to the repo is invisible to the running dev container until
someone deletes that volume, and nothing anywhere says so.

## Open, as of round 532

Everything both Fable fleets confirmed is fixed: 2 critical/high, 13 medium, 15
low, across 30 findings. What follows is what is NOT fixed, stated so the next
person does not have to infer it from silence.

### `reconnection_p2p_one_c2s` — FIXED in #302, entry kept for the reasoning

`RemoteDisconnectEventMissing` — a 30s wait for a `Disconnect` that never
arrives. Seen on Windows and on ubuntu multi-threaded, on two PRs that cannot
have caused it (a one-line log change and a single `else` branch).

Eliminated by reading, so nobody repeats them:

- `Disconnect` has none of the `cid_opt` routing asymmetry #295 fixed for
  `InternalServerError`; both emitters (`session.rs:2554`,
  `session_manager.rs:1052`) set `cid_opt: Some(session_cid)`.
- The pending-disconnect ticket is not double-taken: the graceful FINAL path
  clears it AND emits with the explicit ticket (`disconnect_packet.rs:113-118`),
  while the ungraceful path uses the pending one. Both route to the caller.

Not reproducible here: 6 targeted runs and a full 97/97 suite on the exact CI
feature set (`multi-threaded,localhost-testing`). PR #297 instruments the wait to
report how many other events the subscription carried — non-zero means it was
alive and the Disconnect went elsewhere, zero means it heard nothing at all.
Those want different fixes and the error distinguishes them not at all.

### The server's BEGIN_CONNECT wait is a bounded poll

Round 526's fix waits for `last_stage == SUCCESS` by polling every millisecond
up to five seconds. A `Notify` on `PreConnectState` would be the better shape.
The poll was chosen because it adds no shared state and cannot deadlock, and
because the fix was wanted before a reproduction went stale — not because it is
the right long-term mechanism.

### Two costs paging moves rather than removes

Persisting one byte-map key still serialises every key for that CID; that is the
account-file format, not the call site. And purging an N-page room now costs N
account-file rewrites where the single blob cost one — the right trade, since a
room is deleted once and written to on every message, but a trade. A batch delete
in the backend would remove it; there is no such primitive.

### The client's UDP promise is still overloaded

PR #299 makes the initiator report a failed punch as "no receiver", matching the
server. But `Option<Receiver>` still encodes both "UDP was never requested" and
"UDP was requested and failed", and a present receiver still means only "udp_mode
was Enabled when I sent SYN" rather than "UDP is negotiated". An architectural
review recommended making the promise honest — a receiver that resolves to an
explicit `UdpUnavailable` — and noted that doing the install half without the
rejection half is exactly what caused a previous 90s hang. That is a larger
change than this campaign should make unattended.

### The lockfile gate read an intention, not a capability

Round 526 added `COPY ./Cargo.lock` to both images and a gate to keep it there.
Both builds then failed with `"/Cargo.lock": not found`, because `.dockerignore`
excluded the lockfile — with the rationale *"let Docker resolve its own deps to
avoid stale git revision hashes"*, which is the failure mode written in the
language of a fix.

The gate passed anyway. It read the Dockerfile text and nothing else: that the
COPY was written, not that the file could arrive. That is the same defect the
gate exists to prevent, one level up, committed two rounds after four other gates
were fixed for exactly it. It now also refuses when `.dockerignore` excludes the
lockfile.

It failed loudly rather than quietly, which is the only thing that makes it a bad
gate rather than a dangerous one — a blind spot that produces a red build costs
an hour; one that produces a green build costs whatever it was hiding.

## Where this ended

Two Fable fleets, 30 confirmed findings, 30 fixed. Six protocol PRs merged
(#293 CRITICAL, #294 HIGH, #295, #296, #297, #298); the workspace's own fixes and
the deliberate protocol upgrade in one PR behind them.

The habit that produced most of it is not "write tests". It is: **run the control
against the check, not only against the code the check guards.** Nine checks this
campaign turned out to be measuring nothing, four of them written in the same
campaign by the same hands, and every one was found by asking what single change
would turn it red — never by reading it.

## Round 547 — CI was green on a vitest nobody ran

`.github/workflows/validate.yml` ran `npm install vitest@3.0.7 --save-dev`
immediately before `npx vitest run`. The root lockfile resolves vitest 3.2.7.
So "CI is green" and "the tests pass locally" were statements about two
different versions of the runner, and neither backed the other. The eslint step
beside it did the same with a version that matches today, which is the same
defect one lockfile bump from being visible.

Neither install was needed: `npm ci` already hoists both to
`node_modules/.bin`, and the ESLint step was already invoking that exact binary
by absolute path.

**Gate:** `check-ci-runs-lockfile-versions.mjs` — no workflow may pin a version
of a package the root lockfile resolves.
**Controls:** defect back → red; a matching-version pin → red; a package the
lockfile does not resolve → green; a comment naming the defect → green.

**What went wrong first:** the first control run used `git checkout` to restore
between controls, on an uncommitted fix. That reverted to HEAD, which still had
the defect, so controls B, C and D were all measuring the original file. Commit
the fix *before* running controls against it.

## Round 548 — the agent instructions named three things that do not exist

These files are executed, not read, so a wrong name is a timeout or a blank
page reported as a broken service.

The sync agent — which CLAUDE.md marks MANDATORY after any backend change —
waited for ``Running `target/debug/…` `` from both services. Both containers run
release binaries out of `/usr/local/bin`. That line is never logged, so steps 2
and 3 could only ever end at the five-minute timeout, on every *healthy*
rebuild. The real lines, confirmed against the running stack, are
`Creating AsyncWorkspaceServerKernel` and `Citadel client established`.

Every UI agent opened `localhost:5173`, 24 times across five files; the dev
server is on 5291 (`:5291` → 200, `:5173` → 000). Three ran
`tilt logs workspace-server`, which names no Tilt resource.

**Gate:** `check-agent-docs-name-real-things.mjs` — Tilt names against
`dc_resource(`, ports against what compose and the Dockerfiles bind, the
`target/debug` marker against the container `CMD`.
**Controls:** each of the three back → red; prose *explaining* the marker does
not exist → green; a legitimate `:12345` → green.

**What went wrong first:** the third control came back green. The edit had not
applied — nested-quote escaping through `bash -c` → `python3 -c` mangled it —
so it was measuring nothing. Re-run with an assertion on the anchor, red. Every
control edit now asserts its anchor before writing.

## Round 549 — the hosting quickstart could not bring the stack up

`docs/INSTALL.md` said `.env` must set `WORKSPACE_MASTER_PASSWORD` and listed
everything else as optional. `INTERNAL_SERVICE_ALLOWED_ORIGINS` is also
required: compose passes it with no default and the agent exits without it, on
purpose. Following the doc exactly ends in a `--wait` timeout with no stated
cause. Exactly two variables in that compose file have no default; one was
documented.

**Gate:** `check-install-doc-names-required-env.mjs` — derives the required set
from `${VAR}` with no `:-`, rather than listing it.
**Controls:** undocument it again → red; a new required var → red; a var *with*
a default → green (without that one the rule would demand documentation for all
five optional variables, and be wrong rather than noisy).

## Round 550 — the protocol guidance described code that does not exist

CLAUDE.md and ARCHITECTURE.md are loaded into every session, so a fictional
operation is an agent writing code against a name that does not compile, or
"fixing" working code to match. Four at once:

- `CreateOffice` / `ListOffices` / `CreateRoom` / `ListRooms` as protocol
  operations. Zero hits in the source. The hierarchy is nodes.
- a triple-nested chat envelope with a `WorkspaceProtocol::Message` layer. The
  send path is a CBOR `P2PCommand` in a bincode `WireWrapper`, sent as an
  ordinary `InternalServiceRequest::Message`.
- `NodeResult::Disconnect` discriminated by `v_conn_type` on `LocalGroupPeer` /
  `ExternalGroupPeer`. The field is `conn_type`; `ClientConnectionType` has only
  `Server` and `Extended`; since SDK v0.13.1 a P2P disconnect is a different
  event. The example handler does not compile.
- six `Permission` variants that the flat enum does not have.

**Gate:** `check-docs-name-real-symbols.mjs` — a backticked CamelCase token must
appear in the tree (4,217 source files, 7,123 identifiers). It hard-errors below
500 files so an uninitialised submodule cannot pass it on an empty haystack —
which it caught on the first local run. Blockquotes are exempt, being where
these files retract earlier revisions; so are Future/proposed/roadmap sections.
**Controls:** two fictions back → red; a proposal, a retraction and a real
symbol → green. The last three each failed the first draft of the rule.

**Method note, three rounds running:** every control this session that came back
green did so because the control itself had not applied, not because the check
was weak. Assert the anchor, and verify the tree is byte-identical after
restoring.

## Round 551 — the master password was compared one byte at a time

`String == String` compares lengths and then runs `memcmp`, which returns at
the first differing byte. How long that takes is a function of how many leading
bytes the guess got right, so guessing and timing recovers the secret a byte at
a time instead of searching the space.

The workspace master password — what makes somebody the administrator — was
compared that way at five sites, four reachable from a request
(`async_domain_server_ops.rs:1043,1069,1231,1307`; `async_kernel.rs:469` is
startup-only and was never a vulnerability). All five now use
`kernel::secret_eq::secrets_match`: SHA-256 both sides, compare the digests with
`subtle`.

Hashing first is not ceremony. A constant-time compare of the raw bytes still
takes time proportional to the longer input, which tells an attacker how many
characters to guess.

**Gate:** `check-secrets-are-compared-in-constant-time.mjs`, over all three Rust
service roots. It reports how many roots it scanned, so an uninitialised
submodule narrows the scan visibly rather than silently.
**Controls:** one `==` back → red; a comment naming the defect → green; a
non-secret `==` → green.
**Propagation:** grepped the mechanism across all three service roots; no other
instances.

## Round 552 — removing a member lasted until they reconnected

The connection handler enrols any authenticated account absent from
`workspace.members` — its own comment says "no admin required for initial
connection". It could not tell *never joined* from *an administrator removed
them*, so `RemoveMember` was undone by the removed account's own next
reconnect, which happens by itself. Nothing was logged; the member list simply
showed them back.

Two more things the old code did not do: it touched the role only for Admin and
Owner, so an ordinary member's removal left no trace at all; and it demoted to
`Member`, which for a Guest was a rank *increase*.

Removal now records itself as `UserRole::Banned` — no permissions, rank 0, and a
role the codebase defined, gave a permission table, and never once assigned.
Re-admission is `AddMember`, which writes an explicit role and clears it.

The decision is extracted as `connect_enrolment`, for the same reason
`first_member_outcome` was: inline in the handler it is reachable only with a
kernel, a backend and a live Citadel session.

**Tests:** 5 new; full kernel suite 77 binaries, no failures.
**Controls:** `connect_enrolment` always `Enrol` → red on 2 of 5; removal
reverted to Admin/Owner→Member → red on the *joined* test only, which is
correct: the pure decision is untouched, and only the joined test asserts that
what removal writes is what connect reads.

**A first design, rejected:** setting the role globally over-reached, since
`user.role` is global and a user may belong to another workspace. Checked
`set_role_permissions` is per-domain before proceeding. The existing tests
caught this, which is what they are for.

## Round 553 — CI was not queued, it was stalled

Reported for two cycles as a deep queue: 262 jobs against 20 slots. It was not.
Zero jobs were executing anywhere — `in_progress=0` across all four repos —
while six runs sat marked "queued", the oldest since 08:03. Cancelling PR runs
to "free slots" did nothing, because no slots were occupied.

Three stale master validate runs from 06:21 and 07:11 were wedging the queue.
Cancelling those, jobs started within 40 seconds.

The causal claim is not airtight: earlier cancellations may simply have been
slow to propagate. What is certain is that the deep-queue explanation was
wrong, and that the check which would have shown it — *are any jobs actually
in progress* — is one API call and was never made.

**Lesson:** a check-count on a PR says nothing about whether CI is running.

> **Corrected later, and the correction matters more than the lesson.**
> Use `node scripts/ci-jobs.mjs <owner/repo> <branch|run-id>`. It reads
> `/actions/runs/<id>/jobs` and prints per-state counts and every failed job.
>
> The command originally written here was
> `gh api "repos/<r>/actions/runs?status=in_progress" --jq .total_count`, a
> RUN-level filter — the exact field that lies. A run's status stays `queued`
> until every one of its jobs finishes, so it returns 0 while dozens of jobs
> execute, and a run whose jobs have already failed reads as "still waiting".
>
> This paragraph then misled twice more: once into cancelling other runs to
> "free slots" that were never blocked, and once into reporting CI as starved
> for hours while a run had been completing with readable failures throughout.
> A lesson that names the right question — *are any jobs actually in progress* —
> and gives a command that cannot answer it is worse than no lesson.

## Round 554 — a read failure was written back as an empty tree

`OpfsStorage.readFile` caught every error and returned null, so a revoked
handle, a quota error, a locked file or any transient `NotReadableError` was
indistinguishable from a first run. `loadTree` returned null;
`RevfsService.getTree` then built a default tree, cached it, and PERSISTED it —
over a tree still on disk (`revfs-service.ts:117`). One transient read error
destroyed the user's files, silently, and the UI repainted as though they had
never existed. Both `getTree` and `getServerTree` had it.

Storage now reports the two cases apart: null only for `NotFoundError`,
everything else rethrown. `RevfsIO.loadTree` returns `unreadable: true` rather
than flattening the failure, and the service renders a default while caching and
persisting nothing — so nothing is destroyed and the next call retries.

**Tests:** 3 + 3; full revfs suite 39 files, 271 tests, no regressions.

**The control that mattered.** Reverting `readFile` to `catch { return null }`
left all three of the first tests GREEN. They stub the IO layer, so they never
execute the storage code the fix changed — the tests measured half the fix and
would have shipped saying otherwise. The second commit adds
`storage-tells-absent-from-unreadable.test.ts`, which drives the real storage
class against a fake OPFS; the control then goes red on exactly the two cases it
should.

That is the third time this campaign that a green control meant the *test* was
wrong rather than the code. It is now the most reliable defect-finder here.

## Round 555 — local lint was weaker than CI lint

CI lints every workspace with `--max-warnings 0`. Two of the three `lint`
scripts a developer actually runs did not, and `citadel-workspace-client-ts`
has `no-unused-vars` and `no-explicit-any` at **warn** — exactly what the
missing flag hides. Both packages already passed under the stricter flag, so
the gap was latent rather than active, which is the only reason it had not
already cost a red CI run.

**Gate:** `check-lint-scripts-match-ci.mjs` reads the required flags off the
workflow's own eslint line rather than listing them.
**Controls:** drop the flag → red; **add a new flag to CI** → red; a comment
mentioning eslint → green. The middle one is the one that matters: it proves
the flags are derived, so the gate cannot drift into agreeing with itself.

## Round 556 — nine tests that never ran

`citadel-internal-service/typescript-client`'s test script ended in
`node --test "dist/**/*.test.js"`. Glob support in `--test` arrived in Node 21;
the CI image is `node:18-slim`, so the quoted glob is taken literally and
matches nothing.

Measured in `docker run --rm node:18-slim`, the same image
`ci/docker-compose.test.yml` uses:

| | Exit | Tests |
|---|---|---|
| Before | 1 | 0 — `Could not find '/w/dist/**/*.test.js'` |
| After  | 0 | **9**, 3 suites |

`citadel-workspace-client-ts` hit this exact failure and solved it by having the
checker emit the paths it found, so one directory walk feeds both the assertion
and the runner. Its own comment names the cause. The fix stayed in that one
package.

The shape is worth remembering: a checker printing "1 compiled test file found"
immediately followed by a runner printing "could not find it". Two components
disagreeing out loud, in CI, and nobody reading the line.

## Round 557 — removing the install that was compensating

Round 547 removed `npm install eslint@9.39.2 --save-dev` on the grounds that the
root `npm ci` already hoists eslint to `node_modules/.bin`. It does — until two
steps later, when the lint job runs `npm ci` **again** inside
`citadel-internal-service/typescript-client`, which is itself a root workspace.
That re-resolves the subtree and unhoists the root devDependencies, and all
three lint jobs died with `exit 127`.

The install was not redundant. It was compensating. The cause is the nested
`npm ci`, and the unit-tests job is the proof: it has never had one, and never
needed a compensating install either.

Memory already recorded this trap in those words — "duplicate `npm ci` in
subdirs breaks hoisting" — and it was not applied. Reading the note is not the
same as consulting it before acting.

**Gate:** `check-no-nested-npm-ci-in-workspaces.mjs`. **Controls:** nested via
`working-directory` → red; nested via `cd` on the run line → red; `npm ci` at
the repo root → green.

## Round 558 — `test:all` reached 39 of 47 specs

`README.md:178` offers `npm run test:all` as the way to run the suite locally.
It never ran `group-messaging`, `native-file-picker`, `tree-structure-editor`,
or **any of the five reconnection specs**.

Each has its own `test:` script, so the orphan gate passed. "Named by a script"
and "run by `test:all`" are different claims and only the first was checked —
while the gate's own failure message said *"and chain it into test:all"*, and
`docs/TESTING.md:304` already warned that `test:all` "would make any matrix look
complete". The hazard was written down twice and implemented nowhere.

The cost is misattributed flake: reproduce a CI reconnection failure locally,
run for an hour against the shared backend, pass, file it as environmental.

**Gate:** transitive expansion of `test:all` with a cycle guard, in the file
that already asked for it. **Controls:** drop the reconnection legs → red; a
spec named by no script → red; `test:all` emptied to `echo nothing` → red
("verified nothing"), which is what stops this gate becoming the thing it was
written to catch.

**Two of my own errors, caught only because the numbers contradicted
themselves:** the first reachability script reported 0 of 47 because its regex
excluded dots and truncated every filename; the first version of the gate
printed "reaches 47 of 47" while listing all 47 as unreached, because the
capture drops `.js` and the comparison kept it.

## Round 559 — a job named after its first step

Nine parent PRs each carried a red check reported as
"Every workspace crate has a lint job: failure". That step passed — its log
says `all 11 workspace crates are covered`. The failure was three steps later
in the same job: `docs/GATES.md is out of date`, because six new gate scripts
had been added across six branches without re-running
`build-gates-index.mjs`.

Every one of those PRs had a guaranteed red check independent of its content,
and the check name pointed at the wrong step. Regenerated on all seven
branches in one pass.

**Lesson:** a CI job named after its first step will mislead you about its
last one. Read the log, not the name.

## Round 560 — the WASM release gate could not fail on a missing WASM binary

The whole WASM assertion in the UI release smoke was: the `Cache-Control`
header is present, and does not say `immutable`. `add_header ... always` in
`docker/ui/nginx.conf.template` emits that header on 4xx too, so a **404 for a
missing binary satisfies both**. Measured against the production image on the
deployment host:

    GET /wasm/does_not_exist_bg.wasm
    HTTP/1.1 404 Not Found
    Cache-Control: public, no-cache
       present?   PASS (wrongly)
       immutable? PASS (wrongly)

Not hypothetical: `sync-wasm-clients.sh` wipes `public/wasm` before
repopulating it and that directory is gitignored, so a partial sync ships a UI
where WASM init throws and every operation silently no-ops — register and login
do nothing, with no error and no backend log line. That incident is on record.

Now asserts status 200 and size > 1MB first. The real binary reads 200 and
2,553,625 bytes.

## Round 561 — a claimed session that is never activated

`session:activated` is the sole trigger for session-startup-sequence. The
sidebar workspace switcher claimed the session, set the index and the user, ran
`postAuthSetup` — and emitted nothing. Because `postAuthSetup` loads the tree,
offices and members, the switch **looked healthy** and the toast said
"Connected!", while the ILM handle was still open for the previous account and
no P2P channels existed for the new one. Outbound messages blocked on ACKs
nobody would send. It is the most common multi-account action in the product.

**The gate found a second site** the inspection agent had explicitly cleared:
`adoptSession` in `use-connect-to-server.ts`, whose own doc says it "mirrors the
orphan-claim path step for step". It did not.

**And my first control came back green** — I had removed the emit and left the
paragraph above it explaining why it was there, and the gate grepped the raw
file, so the prose satisfied it. The gate now strips comments. This is the same
defect the test-quality agent reported the same hour in
`offline-banner-layering.test.ts`, which asserts on a class name that exists
only in comments.

## Round 562 — a failed read reported as an absent document, then overwritten

`loadDocumentFromDB` caught every error and returned `null`. Its own comment
said why that was wrong and returned null anyway. `adoptDocument` acts on that
null by writing a fresh revision-0 document over the top, so a routine 5s
LocalDB timeout replaced a real document with an empty one, permanently.

`isGenuinelyAbsent` exists for exactly this. Its doc already names the same
failure in the message store ("one transient timeout destroys a conversation")
and in the auto-connect preference — and the correct form was **fifty lines
below in the same file**, in `deleteDocumentFromDB`.

`loadIndexIntoCache` gained a per-document try/catch: it iterates the whole
index, so making the read throw would otherwise have meant the first unreadable
document abandoned every one after it — a regression dressed as a fix.

## Round 563 — the targetCid fix was held in place by nothing

UI #27 added `targetCid` so a tab signed in as somebody else stops applying the
leader's workspace. Two tests referenced it; neither held it. One greps a
600-character window of a *different file* for a *different symbol*. The other
hand-builds an envelope with the field already populated, asserting the
receiver's behaviour against something production need not produce.

Measured — delete `targetCid,` from the builder:

    the two existing tests   5 passed     <- green, wrongly
    the new test             1 failed     <- red, correctly

Covered at both ends and never in the middle.

## Round 564 — the tests holding the agent's security boundary never compiled

`websockets` is not a default feature, and CI named it on neither platform. So
the entire `io_interface` module was `#[cfg]`-ed out on every run.

    --features=vendored              6 passed
    --features=vendored,websockets  33 passed

The 27 that never compiled are the ones enforcing loopback-only: an unlisted
origin refused at the handshake, a permitted origin on a foreign Host refused
403, plain ws to the TLS listener refused, the wildcard unable to hide inside a
list, and the idle-client DoS fix. The agent holds decrypted P2P plaintext and
an unauthenticated control plane; these are what keep it reachable only from the
user's own machine, and nothing was checking them.

### The through-line of rounds 560-564

All five are the same defect, not five defects: **the work was done, and the
thing meant to hold it in place measured nothing.** A gate that passes on a 404.
A fix with tests that read a different file. Security tests behind a flag nobody
set. An index built from half its roots. In every case the code was right and
the check was theatre — which is worse than no check, because it reports safety.

The habit that found all five is unchanged and remains the highest-yield one
here: run the control against the *check*, not only against the code the check
guards.

## Rounds 565-571 — the correct form was already nearby, seven more times

This block is recorded as one entry because the findings are one finding.
Every item below had a sibling in the same file, often within twenty lines,
that did the right thing.

| Round | Defect | The sibling that was right |
|---|---|---|
| 565 | An exact spec count in README broke the parent on every UI addition | — (a floor, not a fix) |
| 566 | `setConnectionAttempt` overwrote a timer without clearing it | `deleteConnectionAttempt`, 20 lines below |
| 567 | `STACK_OVERVIEW.md` had `cid`/`peer_cid` inverted | the agent's own `// RECIPIENT` comment |
| 568 | A refused group leave removed you from your own member list | `GroupEndNotification`, 20 lines below |
| 569 | A peer who left mid-open came back; the call could never end | the failure path, 20 lines below |
| 570 | Redelivered messages stacked a second bell entry | — (the test asserted the argument, not the effect) |
| 571 | The idle-send test failed on one scheduler hiccup | — (a relaxation, with arithmetic) |

Round 566's cost: with 15 offline peers and a tab open an hour, ~1,800 live
timers, each firing a `connectToPeer` that reads the CID from IndexedDB and can
open a real connection against the SDK's 30s timeout.

Round 569 is the most severe: `openSessionFor` re-read the CALL's status after
its await but never the PARTICIPANT's. Teardown could not cover it —
`closeSessionFor` returns early on `!openSessions.delete(cid)` and a peer whose
open has not resolved is not in that set yet. So a peer leaving mid-open got a
close that no-oped, their open confirmed, and `peer-connected` marked them
active again: a ghost tile, a media session held open forever, `sendFrame` still
encoding to somebody who left, and `anyoneActive` true for the ghost — camera
light on, duration ticking, nobody there.

Round 570 is the clearest example of a test certifying a guarantee the product
did not have. "keys a redelivered message to the same id, so it cannot stack"
mocked `addMessageNotification` wholesale and asserted the ARGUMENT. Nothing
reached the method that assigns the id. **That test is deliberately left
unrepaired** — it still passes with the fix in or out, and repairing it would
erase the evidence.

Round 571 relaxes a guard, which is the move to be most suspicious of, so the
arithmetic is in the commit: under the defect each leg exceeds the bar with
p≈0.5, so over 8 rounds `worst < bar` catches it 99.6% of the time and
`at most 1 slow leg` catches it 96.5%. Three points of detection for immunity to
a single hiccup.

### Two of my own mistakes, both caught by controls

Round 566's gate came back GREEN on its first control: I had removed the emit
and left the paragraph above it explaining why it was there, and the gate
grepped the raw file, so the prose satisfied it. The gate now strips comments.
The test-quality agent reported the identical class the same hour, in a spec
asserting a class name that exists only in comments.

Round 567's `verify:` pin took three attempts to parse — first inside a
blockquote (the parser needs `#` or `<!--` at line start), then with double
quotes where it wants single. Both times the annotation silently did nothing. A
decaying pin becoming a no-op is exactly what that gate family exists to
prevent, and I nearly shipped one.

### The constraint moved

Two independent agents rediscovered a bug already sitting in open PR #98 this
hour, and the release agent's top finding was already open as UI #25. Finding is
now well ahead of landing: ~20 PRs open, 8 merged today. The useful work is
clearing failures on PRs that exist, not opening more.

## Rounds 572-573 — the reviewer found the defect in the reviewer's own PR

An inspection agent was pointed at the OPEN pull requests rather than at the
codebase, and asked one question of each: *what single change to production
code should turn this PR's test red?* It found a real defect in #107, a PR I had
written and controlled hours earlier.

**#107 left every per-node grant behind.** It set a removed account to `Banned`
and called `set_role_permissions(ROOT)` — which writes exactly ONE key. And
`check_entity_permission` honours a direct grant BEFORE it consults role or
membership. So a member added to room R and then removed from the workspace went
on reading and posting in R, and receiving R's group broadcasts, while
`ListNodes` correctly refused them. Removal looked like it worked, and the PR's
own tests agreed.

The correct form was twenty lines above, in `write_user_role_locked`:
"Revoking everything is what a ban means", clearing every key when the role
grants nothing. Reusing it directly broke a passing test — it re-runs
`ensure_not_last_admin`, and by that point the membership write has already
removed the account, so removing an administrator is refused. The clear is
applied inline with that reason recorded.

## Round 574 — a red clippy still ran the whole Docker matrix

Measured, not estimated: one parent PR run is ~1,281 runner-minutes and the
integration matrix is 87% of it. The `needs:` edges gated only three cheap jobs,
so a failing `cargo clippy` still fanned out 55 Docker jobs — about 1,230
minutes on a change that could not merge. That happened THREE times in one day,
each on a trivial `-D warnings` lint: a needless borrow, a dead-code gate, an
unused import. With 20 slots shared across four repos, it is also the queue
everything else waits behind.

All four Docker jobs now wait for all five cheap gates. **Writing the gate found
two the manual pass missed**: `playwright-tests` had no
`internal-service-rust-lint` edge, and `deploy-gate-tests` had no `needs:` at
all. A lint-red PR now costs about 25 jobs instead of 74.

### Two stale signals, one caught, one to watch

A monitor reported "#100 ALL GREEN" for a commit that had already been replaced
by my own push seconds earlier. Comparing `headRefOid` against my last commit is
what caught it; the replacement monitor pins the SHA and says so if the head
moves. Merging on that reading would have shipped a different tree than the one
CI passed.

CI then stalled a second time: zero runs executing across all three repos with
eleven queued, none older than 86 minutes — so not the stale-wedge cause from
earlier. Cancelling dependabot runs and parking everything but #100 did not
start it. The most likely cause is GitHub-side throttling from the volume of
runs created and cancelled today, which is self-inflicted and decays on its own.
The correct response is to stop generating CI load, not to generate more trying
to clear it.

## Round 575 — the pre-push guard refused every push made from a worktree

Trying to push the round 572–574 entry, the submodule-pointer guard refused it
and named four submodules as unpushed — two of them, `citadel-internal-service/
citadel-internal-service` and `citadel-internal-service/citadel-workspaces`,
paths that do not exist. The pointers it objected to were byte-identical to
`origin/master`'s.

A linked worktree does not populate submodules. `wt-docs/citadel-internal-service`
is an empty directory, and `git -C` inside an empty directory walks up and
answers as the **parent** repository. Every question the guard asked went to the
wrong repo: `branch -r --contains <sha>` printed `no such commit` for commits
that are on the remote, and the recursion re-read the parent's own pointers
under a nested prefix. On a fixture with one submodule it recursed until it
exhausted memory — the report contained `sub/.//.//.//…` repeated about 10^5
times.

All the work here happens in worktrees, so this was the guard blocking correct
pushes essentially always — the state its own comment names as the reason a
guard gets switched off.

Submodule repositories are now addressed by **git directory**
(`<git-common-dir>/modules/<name>`, which every worktree shares) instead of by
working directory, with the name read from the `.gitmodules` of the commit under
inspection because a name may differ from its path. Two further corrections fell
out: a submodule whose repository cannot be found is reported as *unjudged*
rather than as absent or as fine, and the recursion descends through the
**recorded** pointer instead of whatever that submodule has checked out — those
two commits differ routinely, and the one that breaks `actions/checkout` is the
recorded one.

`check-submodule-gate-judges-a-worktree.mjs` builds real repositories in a temp
directory and asserts both directions from a linked worktree: a fully-pushed
tree passes, and an unpushed pointer is still refused *by name*. The second
assertion is the control — without it, a guard gutted into always passing
satisfies the first. With `origin/master`'s guard restored the test fails; with
the fix it passes both.

Preflight: 92 of 93 green. The one failure, `generated artefacts present`, is a
fresh worktree having no built WASM.

## Round 576 — every group notification was delivered to the owning tab twice

The leader runs two delivery paths over each inbound message: the inbound router
forwards to the tab owning the message's CID, and `broadcastWorkspaceResponse`
posts to every tab, which then filters by CID. The gate between them asked
whether the type was in `CID_ROUTED_NOTIFICATIONS` — a list written to answer a
different question (when *not* to route by request_id), holding nine of the
internal service's seventeen notification variants.

So anything routing by CID without being on that list was delivered twice. The
seven remaining group notifications are all built with `request_id: None` and a
recipient `cid` (`kernel/responses/group_event.rs`, `kernel/requests/mod.rs`),
so every group invite, join request, member-state change, leave, end and
disconnect reached the owning tab twice. A duplicated invite is a duplicated
auto-accept. `DisconnectNotification` was worse: the router broadcasts it to
every instance and the legacy path broadcast it again.

The gate now asks the router what it did. `routeMessage` returns whether it
delivered: true when it broadcast to all, when a pending request claimed it,
when the instance owning the CID has it, or when the message was deliberately
dropped; false when no instance owns the CID (buffered — the broadcast stays the
second chance it has always been) and false when there is no CID at all. A
verdict from what happened cannot drift the way a hand-kept list of type names
does, which is how that list came to be eight variants short.

**What the investigation ruled out.** The suspicion carried in the backlog was
misrouting — that these notifications carried the *sender's* request_id and were
delivered to the wrong tab. They do not: every construction site sets
`request_id: None`, so `extractRequestId` already returned null and the router
already routed them by CID. And the cross-session leak was already closed
generically in an earlier round — `handleWorkspaceResponse` reads the payload's
own `cid` via `notificationCid()` and skips a mismatch. What survived was the
duplicate, which is a real defect and a different one.

Controls: with `origin/master`'s two files restored, 11 of the 12 new assertions
fail. The twelfth stays green — it asserts that an *undelivered* message is
still broadcast, which this change does not alter, and it is the control against
a gate hard-wired to never broadcast.

## Round 577 — the shipped bundle's onboarding was never asserted

Onboarding must run in production and NOT in development, so the integration
suite's ~90 account creations do not each pay the two extra interactions it
costs. Two things checked that, and both checked one side of it.
`onboarding-gate.test.ts` asserts `isOnboardingEnabled()` with
`import.meta.env.DEV` mocked — the gate's logic, not the bundle's value of DEV.
The onboarding specs run against the Vite dev server and force `?onboarding=1`,
which returns at the param branch **before** `!isDev` is ever evaluated.

So a production build with DEV somehow true would ship with no onboarding at
all and every existing check would still be green.

`check-production-image.mjs` — the only check that drives a browser against the
real image — now loads the landing page with no query parameter in a fresh
context, where `isOnboardingEnabled()` can only reach `return !isDev`. Both
branches are asserted, and that it comes before the wizard rather than beside
it. The control is `?onboarding=0`, whose pass signal is `wizard-next` rather
than the dialog's absence, because absence is also what a page that never
handled the click looks like.

Verified against a real `vite build --mode production` bundle: dialog present,
both branches, wizard not yet open; with `?onboarding=0` the wizard opens
directly and the dialog count is zero. The bundle inlines `catch{}return!0`,
which is `!isDev` resolved to true — the requirement is met in the artefact,
now demonstrated rather than assumed.

**The negative control was wrong twice.** "The Create Account button went away"
is not a click-landed signal: the wizard overlays the landing page, so the
button stays in the DOM, and that version reported a failure that was not one.
Then `vite build --mode development` did not flip DEV at all — both bundles
inline the same byte, so a green control there proved nothing. The control that
worked patches that exact byte to `return!1` in a COPY of the real bundle; the
assertion then times out waiting for the dialog. The real dist was confirmed
unpatched afterwards and re-verified green.

## Round 578 — a retry queue that never reached disk told nobody

`persistTree` reads `execute`'s result and raises `revfs:persist-failed`, which
`PersistFailureNotice` renders. That fix was applied to one of the two places it
belongs. All four `persist-pending-ops` calls in revfs-retry.ts discarded the
result, so a failed write was invisible: the user made edits, the app queued
them for retry, the queue did not reach disk, nothing was shown, and the
operations were gone after the next reload. The notice component was already
built and already listening.

The gate for this shape could not see it. `check-intent-results-checked.mjs`
matched `await \w+\.execute\({`, which matches `io.execute(` and not
`deps.io.execute(` — and those four are the only unassigned `execute({` calls
in the tree. It considered **zero** sites on every run since it was written and
reported success. Receiver is `[\w.]+` now, plus a floor that refuses to pass on
an empty candidate set.

## Round 579 — preflight ran a check-only gate as a write

CI runs `node scripts/build-gates-index.mjs --check`. Preflight's workflow parse
captured the script path and dropped the rest of the line, so it ran the same
script with no arguments — the branch that WRITES docs/GATES.md. Preflight
rewrote a tracked file in the working tree and printed `build gates index … ok`
for a gate that cannot fail, because the write branch always succeeds.

`--print-plan` plus `check-preflight-runs-what-ci-runs.mjs` compares the two
argument lists; 80 shared gates agree. Two things cost time and are recorded in
the code: `process.exit(0)` after a `console.log` truncates a piped write at the
8 KB pipe buffer (the plan is ~40 KB, and the reader got JSON that stopped
mid-token), and the gate must bound its subprocess — running the control against
the previous preflight ran the entire suite and **rewrote docs/GATES.md on the
way past**, from a worktree with unpopulated submodules, dropping 46 of its 96
rows. The defect demonstrated live while testing its own fix.

## Round 580 — the gate that saves the matrix took its whole job down

`check-expensive-jobs-wait-for-cheap-ones.mjs` parsed the workflow with js-yaml
and runs in the crate-coverage job, which installs nothing. CI died on `Cannot
find module 'js-yaml'` and took every other gate in that job with it, on the run
meant to prove the gate works. Two gates here already carry a comment about
this; check-ci-job-timeouts says "Third time." This was the fourth.

Reading the job's raw text was then wrong in a way the first control caught:
integration-tests and playwright-tests came out classified as CHEAP because
their *comments* mention eslint and clippy, and a job cannot need itself, so the
gate demanded impossible edges. It collects `run:` bodies and `uses:` values
only now.

Controls five ways — dropping each of clippy, lint, typecheck, fmt and
internal-service-rust-lint from one Docker job's `needs:` makes it name that
pair and exit 1. **The first control came back green**, because I removed
`crate-coverage`, which the CHEAP pattern does not match. Recorded, because a
green control is indistinguishable from a gate measuring nothing until you check
which of the two you are looking at.

### What the inspection wave found that reading had not

Four read-only sweeps. Two of their findings are the two rounds above. Two
independent confirmations are worth recording: the routing sweep found round
576's duplicate delivery on its own and named a wider set — `PeerConnectSuccess`,
`MediaSessionOpened/Closed/Failed` and the file-transfer successes are affected
too, which the router-verdict fix covers generically rather than by adding names
to a list. And the performance sweep reported the `GetNode` deep clone as still
live on master, which is correct: the fix is open as PR #110, not merged.

Still open from that wave, unverified by me: `RemoveMember` leaves per-room
grants standing (round 522's ban fix, not propagated); `AddMember` on a room
overwrites the member's *global* role; an Owner can ban an Admin; `fnv1a64` runs
in production because it is an argument to a no-op `debugLog` (measured at 371ms
for 1MB, on the main thread).

## Round 581 — an Owner could ban, demote or remove an Admin

`ensure_may_grant_role` closed one direction: you cannot hand out authority you
do not hold. The other was open. Nothing anywhere compared the actor against the
target's **current** role, so the rule was "you may not promote above yourself"
with no matching "you may not demote someone above you".

`Permission::for_role(Banned)` is EMPTY, so the granting check passes trivially
for every actor — banning is granting nothing. An Owner holds 25 of the 27
permissions and lacks Admin's `All`, so `an_owner_cannot_grant_admin` already
passed while the same Owner could unseat that Admin through three doors:
`update_workspace_member_role`, `remove_user_from_domain`, and
`add_user_to_domain` with `role: Banned` at the root.

`ensure_not_last_admin` is not this guard. It refuses only the change that
empties the admin set; with two administrators present it permits either to be
unseated by anyone who passed the entry gate.

`ensure_may_act_on` uses the same comparison as the granting side, pointed at
the target's role, so the two cannot drift. Self-action is exempt: standing down
hands nobody any authority, and the last-admin guard already refuses the one
case that matters. Control: neutered to `return Ok(())`, exactly the four
refusals fail and the four permissions pass. Full kernel suite 355/355.

**Two of the three findings from that sweep were already fixed in open PRs** —
per-room grants surviving removal (#107) and AddMember overwriting the global
role (#98). The agents read origin/master, so they reported them as live.
Checking before building saved two duplicate fixes; it is worth doing every
time a sweep reports against a branch that is not where the work is.

**A behaviour change worth naming.** An existing test asserted that an Owner
demoting the Admin succeeds. That is now refused, and its vehicle changed (the
Admin steps down itself) so the test's own subject — the last-admin guard — is
untouched. If "Owner" is meant to outrank Admin, this is the round to invert;
the code currently says the opposite, in `ensure_may_grant_role`'s own comment.

## Round 583 — a per-byte fingerprint ran in production, for a noop logger

`debugLog` is a noop in production, and JavaScript evaluates arguments before
the call. `fnv1a64` is a BigInt loop over every byte: measured here at 0.54 ms
for 1 KB, 91 ms for 64 KB, 255 ms for 1 MB, on the main thread. Three call sites
evaluated it as a `debugLog` argument, two of them on the same message, so a
64 KB Yjs update or file chunk cost roughly a quarter-second of blocked UI for
three strings nobody read.

The fingerprint stays — it is byte-identical to `messenger/mod.rs`'s, which is
what lets a message be joined from ILM delivery through the router to the P2P
handler. `debugEnabled` is exported for this and documented as being only for
arguments that cost something. `check-expensive-diagnostics-are-guarded.mjs`
holds it, deliberately narrow: a blanket "no calls in debugLog arguments" would
flag `String(x)` hundreds of times, and a gate that cries wolf gets switched
off. Two controls — unguard a site, and rename the helpers so the candidate set
is empty; both exit 1.

### The more interesting half: five partial mocks

Adding one export to debug-config broke a test that mocks it with a factory
listing only `debugLog`. Vitest raises "No debugEnabled export is defined on the
mock", the module fails to load, and it reads on screen as **the code under test
doing nothing** — `expected [] to have a length of 1`. Four more files had the
same shape. All five now spread `importOriginal`. No gate: this failure is loud
and immediate at the import, and gates earn their keep on silent failures.

One extra failure in the first full run, `outbound-queue-replay`, passed in
isolation and did not reproduce in a second full run — a parallel-run flake,
recorded with that evidence rather than asserted as unrelated.

## Round 584 — two corrections about CI, one of them mine twice over

I reported CI as "stalled" twice. It was not — `node scripts/ci-jobs.mjs` reads
the jobs and would have said so. `gh run list --json status` reports
a RUN as `queued` until every one of its jobs finishes, so a run with eight jobs
executing reads as queued. At job level the parent repo had nine jobs in flight
the whole time.

What was real is different: **#100 was starved.** Its 22 jobs sat with none
running behind a 74-job docs run and a 66-job preflight run, in an org that
shares 20 slots across four repos. #100 is the change that makes every future
run a third the size, so cancelling the two runs ahead of it was the correct
prioritisation, and it started within two minutes of doing so.

The lesson is narrower than "CI is slow": the field that looks like a queue
depth is not one, and a wrong reading of it sent two waves of effort at the
wrong problem.

## Round 585 — the UI image shipped the WASM binary twice

`dist/assets/citadel_internal_service_wasm_client_bg-*.wasm` is 2,553,625 bytes
and byte-identical to `dist/wasm/citadel_internal_service_wasm_client_bg.wasm`
(same md5, verified). The running code fetches the second one:
`InternalServiceWasmClient` always calls `wasmModule.default('/wasm/...')` with
an explicit path, because Vite mangles `import.meta.url` inside the glue.

The duplicate exists because wasm-bindgen's glue ends with a fallback —
`if (module_or_path === undefined) module_or_path = new URL('..._bg.wasm', import.meta.url)`
— and Vite resolves that statically even though the branch never runs. So 2.4 MiB
of dead weight in every image layer, every registry push and every deploy, and
served from the origin.

A `globIgnores` entry already kept it out of the service worker's precache, with
a comment correctly naming it "a hashed duplicate the bundler emits and nothing
ever requests". That solved a different problem and left the file built and
shipped.

The transform rewrites the expression to the path the client already uses, which
removes the emitted asset AND makes the dead fallback correct: a future caller
that omits the argument now resolves to the file that is actually served. It
throws if the pattern is absent, because a silent no-op would put the duplicate
back on the next wasm-pack output whose wording changed, and nothing would say
so.

## Round 586 — the dev agent was bound to every interface

`docker-compose.yml` set `INTERNAL_SERVICE_BIND_HOST=[::]` on a service running
`network_mode: host`. That is every interface of the developer's machine. The
agent holds decrypted P2P plaintext and an unauthenticated control plane —
`GetSessions` enumerates every account signed in, and a WebSocket is exempt from
the same-origin policy and from CORS preflight — so anyone on the same office or
café Wi-Fi could open `ws://<devbox>:12345` and act as any of them. The file's
own comment, twenty lines below, describes that consequence as the reason the
Origin allowlist exists. Production has always bound `127.0.0.1`.

The widening was deliberate and correct at the time: the Vite dev proxy dialed
by hostname, `localhost` resolves to `::1` first on macOS, and an IPv4-only
socket refused it. **That proxy was later pinned to `127.0.0.1`** — its own
comment reads "127.0.0.1, NOT localhost … this was the one place that did not".
Two fixes landed for one bug; only one was still needed, and the redundant one
kept its exposure.

`check-agent-binds-loopback.mjs` holds it, and **what it does not flag is the
substance of it**. A bind address is only a boundary when the socket is on the
host's network. `docker-compose.local.yml` binds `0.0.0.0` on a private bridge
network with no `ports:` — the container's interfaces, where loopback would make
it unreachable from its own siblings. The first version of the gate failed that
file, and a gate that cries wolf on the safe configuration is how the unsafe one
gets widened. It now judges per-service exposure, and refuses to pass if no
service is on the host's network at all.

Controls three ways: dev `[::]` → red, production `0.0.0.0` → red,
bridge-network `0.0.0.0` → stays green.

## Round 587 — a document that could not be read was replaced with an empty one

`loadDocumentFromDB` returned `null` for both "no such key" and "the read
failed", under a comment saying "reporting it as missing, which it may not be".
`adoptDocument` reads null as "not stored yet" and writes a fresh empty document
over the key. One timed-out LocalDB read on reopening a document replaced its
content and its entire revision chain.

`deleteDocumentFromDB`, **twenty lines below in the same file**, already drew the
distinction — "Real failures must surface" — and `isGenuinelyAbsent` was already
imported at the top. That helper's own header lists four earlier sites of the
same mistake. This is the fifth.

**The first version of the adopt test could not fail**, and the control is what
showed it: it mocked `../persistence`, the module holding the defect, so with
origin/master's loader restored the loader test went red and the adopt test
stayed green. A test that replaces the broken function with a correct fake
measures the fake. The fake moved one layer down to `websocketService`; two
tests now fail on master's code and the four absence assertions still pass.

tsc caught a private constructor that vitest ran happily, and each case builds
its own store — `getInstance` memoises and adopt's first line is a cache check,
so a shared instance would have answered before any read happened.

## Round 588 — the UI testing agents pointed at a port nothing serves

Twenty-four references to Vite's 5173 default across five `.claude/agents/*.md`
files, while the UI serves 5291. One of them is a prerequisite check:
`basic-p2p-test` curls 5173 and, on the refusal it will always get, aborts with
"Check if `tilt up` is running and UI service is healthy". So that agent could
never run, and its own error sent the operator to restart a healthy stack.

`check-docs-name-the-real-ui-port.mjs` derives the port from `vite.config.ts` and
the UI Dockerfile rather than containing it — a gate with the number in it is one
more copy to drift, and drift is the defect.

**The first control run came back green and the gate was not at fault.**
`sed -i '' '0,/re/s//../'` is a GNU address form that BSD sed ignores silently,
so the file was never edited. Worth recording: a green control is
indistinguishable from a check that measures nothing until you find out which —
and here it was neither, it was the control that had not run.

## Round 589 — two gates agreed with each other and were both wrong

CI checks binding freshness with `git diff --exit-code -- bindings/`, under a
comment calling it "the freshness check the parity gate cannot make". It cannot
make this one either, structurally: ts-rs writes files and never deletes them, so
a removed type leaves its binding untouched and the diff clean; and a newly
exported type produces an untracked file, which a diff also ignores. That step
can only fail on a **shape change** to an existing type.

Found by counting — 26 binding files against 23 `#[ts(export)]` sites. `Office`,
`Room` and `ListType` were deleted from the Rust source in February 2026 and
their bindings sat there for seven months, still re-exported to consumers.

`check-generated-types-fresh` did not catch it because it compares the two
*copies* of the bindings to each other, and both carried the same three ghosts.
**Two gates that agree with each other are not the same as two gates that are
right.** The new gate compares exported type names against binding filenames in
both directions, and refuses to pass if either set is empty.

### Where the waves stand

Finding is still far ahead of landing. #114 merged — the first parent merge of
the day — and five parent PRs plus two UI PRs sit at "1 pass, N pending" because
the account is throttled. That throttling is the direct consequence of the run
churn earlier in the day: 37 cancelled runs. The lesson already recorded in round
574 is holding up, and the correct response remains to stop generating load
rather than to generate more clearing it.

## Round 590 — a preference that could not be read was treated as a preference

Both auto-connect loaders caught every `sendLocalDBGet` rejection and returned
their default — `true` for enabled, an empty set for the sessions the user had
signed out of. So one transient failure turned auto-connect back ON for somebody
who had turned it off, and made every session they had deliberately left
reconnectable again.

It was already written down. `loadEnabledSetting` carried the paragraph "A
FAILED read means nothing at all — and returning the default there is how a user
who turned auto-connect off finds it back on after one timed-out request",
`isGenuinelyAbsent` was imported, and **the two branches differed only in their
log text**. The predicate's own header names this service as one of the sites it
was written to fix.

And it was swallowed twice: `init()` caught whatever the loaders threw, set
`isEnabled = true` and `isInitialized = true`, and returned — and `init()`
returns early when initialised, so the wrong answer was latched for the whole
session.

Unknown now resolves to OFF rather than to the documented default of on, because
the two errors are not symmetric: not connecting when the user wanted it is
visible and recoverable, connecting when they asked not to is neither.

The decision is extracted (`loadAutoConnectSettings`) rather than inlined,
because the service class sits in an import cycle through `index.ts` — a test
that constructs it fails at module load. A decision reachable only by mocking
five collaborators is a decision nobody checks.

## Round 591 — the master password was written to the log

`async_process_command` logs `"Processing command: {command:?}"` at `debug!`, and
three request variants carry `workspace_master_password` as a plain `String`. So
raising `RUST_LOG` to `citadel=debug` — which an operator does precisely when
about to paste a log into a ticket — wrote the credential that makes somebody an
administrator, in clear.

The redaction mechanism was already present and already in use: `#[debug(with =
...)]` redacts the metadata byte blob **on the line below** each password field,
and `ServerConfig` hand-writes a `Debug` that redacts the same secret. It was
applied to a byte blob and to one struct, and not to the credential between
them.

## Round 592 — a wrong password answered differently from a wrong caller

`create_workspace` and `update_workspace` verified the password FIRST and the
caller's authority second, and the two refusals return different strings. So
anyone who could reach either endpoint had an online oracle: one boolean per
guess, at 100 requests per second, with a rate limiter that resets its bucket
each window, no invite gate on registration and free CIDs.

`create_workspace` reorders trivially. **`update_workspace` could not**: its
authorisation depends on the record it is about to change, because an unowned
workspace is claimable by whoever presents the password — that is how the first
administrator is established. A naive swap would have closed the bootstrap. The
order there is read, authorise, then verify.

`delete_workspace` already did it in this order and says so in its own comment.
Third instance this session of the correct code already being present in the
same file.

The test compares the two refusals **to each other** rather than to a fixed
string; a string match would pass the moment somebody reworded one, and the
property is indistinguishability, not any particular text.

## Round 593 — CI ran a different test runner from the lockfile

`npm ci` installs what the lockfile says; the step after it installed
`vitest@3.0.7` over the lockfile's 3.2.7 and rewrote package.json and the lock in
the runner. Every unit test in CI ran two minor versions behind the one they
were written against, and both logs say only "vitest" — so a behaviour
difference reads as "passes locally, fails in CI" with the version never
suspected.

**Verified before deleting**, because removing a redundant-looking install here
previously broke all three ESLint jobs with exit 127 — that one had been
compensating for a nested `npm ci` that broke hoisting. Here `npx vitest`
already resolves the root-hoisted 3.2.7 and both preceding build steps are bare
`tsc`.

The gate then found the copy I was not looking for: the UI submodule's own
workflow carries the identical step. The parent's commit is held until that
lands, because until the pointer moves the gate is correctly red on a real
override still in the tree.

### On sequencing

Two merges landed (#114, UI #38). One PR (#119) turns out to have **no workflow
run at all** — only GitGuardian fired — so it can never merge until the event is
re-triggered. Worth recording as a failure mode: a PR showing "1 pass" and
nothing pending is not a green PR, it is a PR whose CI never started.

## Round 594 — a gate satisfied by its own explanation

`.claude/agents/sync.md` tells an agent to poll for readiness markers. Nothing
checked that the markers are strings the services actually print, so a marker
could rot silently and every sync would time out at five minutes with no
indication of why. `check-readiness-markers-are-printed.mjs` extracts the
quoted marker from each polling instruction and requires a source line that
emits it.

It passed on its first run, and the pass was fiction. The gate walks `scripts/`,
which contains the gate, and its own header comment quotes
`Citadel client established` as an example of a marker. It found its own
sentence. Excluding `SELF` turned it red — and the red was **correct**: that
marker is emitted by `citadel_proto`, a dependency, so no search of this tree
could ever find it.

Deleting the check would have been the easy answer. Instead a marker may now
carry `<!-- emitted-by: <crate> -->`, and the crate is verified against
`Cargo.lock`. That is the most this repository can know, and it keeps the teeth:
an unprintable marker still cannot pass without naming a real dependency, which
somebody has to write on purpose.

The first version of that normalisation was itself wrong — it rewrote `_` to `-`
before matching, and `citadel_proto` is literal in the lock, so it rejected the
valid attribution it had just been built to accept. All three spellings are
accepted now.

## Round 595 — an allowance above the real length

`check-file-length.mjs` carries per-file allowances for files that predate the
250-line cap. Nothing checked that an allowance still corresponds to a file that
long. Every one of the seven had been written when the file was longer, so a
file could grow by dozens of lines and stay green because its allowance had been
sized for a version that no longer existed.

The gate now fails when an entry sits above the file's real length, and names
the number to lower it to. All seven were tightened in the same commit. The
control is the reverse of the usual one: raising an allowance by a line must go
red, which proves the check reads the file rather than the table.

## Round 596 — a whole-list write where a single-session write belonged

Session persistence read `citadel_sessions`, modified one entry, and wrote the
whole map back. Two tabs doing that concurrently lose one of the two writes, and
the loser is silent. `persist-one-session.ts` narrows it to a read-modify-write
touching only the addressed session.

The module then caught a defect in **itself** during stacking. On a *failed*
read — storage denied, quota, private mode — it fell back to this tab's
in-memory list and wrote that, which is precisely the whole-list clobber the
module exists to remove. The comment above the fallback said "a failed read is
not an empty list". The code treated it as one. Genuine absence now returns
`null` via `isGenuinelyAbsent`; every other error rethrows.

## Round 597 — a disconnect that failed reported success

`requests/peer/disconnect.rs` matched on the SDK's outcome and answered the same
way for a completed disconnect, an error, and a timeout. A user who pressed
"log out" against a wedged session was told it worked. `disconnect_outcome.rs`
makes the three cases a type — `SdkDisconnect::{Succeeded, Failed, TimedOut}` —
so the response is derived from the outcome rather than assumed.

The negative control for this one came back green, and the reason is worth
recording: the control **did not compile**. A non-exhaustive match failed cargo
before any test ran, and the exit code being read was the grep's, not the
suite's. A control has to be shown to have *run* before its colour means
anything.

## Round 598 — fifteen CI passes collapsed into three

Thirty-three open PRs, each triggering a full validate run, against an
organisation whose shared runner slots were already saturated by a sibling
repository. The user's instruction was to stack them: one pass instead of
fifteen.

Three stacks, one per repository, merged in dependency order:

| repo | PRs folded | conflicts | local verification |
|---|---|---|---|
| parent | 21 | 19 auto, 2 by hand | 61 gates green |
| UI | 10 | none | tsc, eslint, 3053/3058 |
| agent | 2 | 1 by hand | 123 tests, fmt clean |

Two of the parent's conflicts were in generated files — `docs/GATES.md` and the
gate-step list in `validate.yml`. Both were resolved by *union*, not by choosing
a side: every entry in both parents belongs in the result. `GATES.md` was then
regenerated rather than hand-merged, because it is derived and a hand-merge of a
derived file is a guess.

The five UI test failures that remained were verified identical on
`origin/master` in the same worktree before being set aside. Each climbs out of
the UI directory to read a file in the parent repository — the agent release
workflow, the server kernel's lib.rs, and the client library's session module —
none of which exist in a standalone UI checkout. That is a property of where the
suite is run from, not of the stack.

### What stacking found that fifteen separate passes would not have

The `persist-one-session.ts` defect in Round 596 surfaced only because the
stacked tree ran all ten UI changes against each other. Alone, each was green.

## Round 599 — the two halves of the system were built against different SDKs

The server is built from the parent cargo workspace; the agent from its own,
inside the submodule. Two workspaces, two lockfiles, and nothing that made them
agree — so `cargo update` in one moved that half of the system forward and left
the other behind.

They had drifted **nine SDK commits** apart, across all fourteen Citadel crates.
The commits the agent was missing:

| commit | what it fixes |
|---|---|
| `d4b3eda1` | answering BEGIN_CONNECT before this side's hole punch resolved |
| `b13d0d71` | a refused request parking the caller for ever |
| `43003230` | a C2S disconnect that could wait for ever |
| `aa1d6957` | binding a packet's header CID to the session that authenticated |
| `52490c0f` | preserving errno on bind/connect; three unbounded receives |

A P2P connect failure, two hangs, and a session-binding fix. That is not a list
of incidental improvements — it is a description of the symptoms this record has
been attributing to flake, including the branch this work was done on.

CLAUDE.md already names "rekey timeouts, P2P connection hangs, protocol errors"
as what a stale SDK looks like. Nothing checked whether the two halves were on
the same one.

### Why it survived

The skew is invisible in every log. Each side builds a valid dependency,
successfully, and says so. Only comparing the two lockfiles reveals it, and that
is not a comparison anybody makes by hand.

`check-git-deps-agree-across-lockfiles.mjs` compares only **git**-sourced
packages: two workspaces on different crates.io patch versions is ordinary; two
workspaces on different commits of the same *protocol implementation* is the
defect. It fails rather than passes when a lockfile is absent, because a gate
that reports success on an empty comparison is the failure mode this repository
keeps finding.

Controls in three states: red on the real skew, green on the aligned pair, red
again after restoring — with the restore verified against git rather than
assumed.

## Round 600 — a browser could ask the agent for any file on the machine

`SendFile` accepted `FileSource::Path(path) => Ok(path)`. Whatever absolute path
arrived on the socket was opened and sent to the peer. The agent holds the
ratchets, so the protocol then encrypted and delivered the caller's own files,
faithfully, to a peer the caller nominated.

The reachable caller is script in the allowlisted page — a hostile MDX document
(the production CSP grants `unsafe-eval` so documents can execute), an XSS, or a
compromised dependency. `PickFile` even returns absolute paths to the browser,
so a page learns real paths to ask for.

### The boundary is not "is the caller local"

Every interface here is loopback. The question is whether naming a path *gains*
the caller anything:

- a native process runs as the user and can already open any file the agent
  could — refusing it protects nothing, and the agent's own file-transfer tests
  send by path over TCP in eight places;
- page script cannot read the filesystem at all, so for it an accepted path is a
  genuine escalation.

That is a property of the caller's other capabilities, and it is knowable at
compile time, because the service is generic over exactly one interface for the
life of the process. Hence a trait constant rather than a runtime check — and
adding it made the compiler point at a fourth implementation nobody had listed.

In the SHIPPED build this refuses every browser `Path`: `native-dialogs` is off
by default and the Dockerfile does not enable it, so there is no picker and the
picked set is permanently empty. That is correct rather than a regression. It
also means the shipped build was the one where the *unvalidated* branch was the
only one that worked, because `PickFileRef` cannot resolve without a picker
either.

### The assertion that passed by never running

The first version was a `#[test]` behind `#[cfg(feature = "websockets")]`. The
connector declares `default = []` and CI runs a bare `cargo nextest run`, so it
was filtered out of every run that mattered. It passed by never executing.

It is a `const _: () = assert!(…)` now, which fails the BUILD of the module
whose behaviour it constrains and cannot be skipped by a feature set or a test
filter. Clippy then required the same of its two siblings, which made all three
consistent.

## Rounds 601-602 — one mechanism, four modules, fifteen write sites

**A whole-collection write performed from a collection that was never
successfully read.**

| module | whole-list writers | round |
|---|---|---|
| the session upsert helper | 2 | 596 |
| `peer-registration-store` | 7 | 601 |
| `live-document-store` | 1 | 601 |
| `connection` session list | 5 | 602 |

In every case a read that FAILED was indistinguishable from a key that held
NOTHING, the empty in-memory list was then written back over the key, and the
write succeeded — so nothing surfaced.

The peer-registration store lied in both directions at once: its read resolved
`undefined` for a KV rejection, a send rejection and a timeout alike, while its
write path rejected on send failure and *resolved* on timeout eight lines below.
Same function, same kind of failure, two answers.

The live-document index was the most costly, because that index is the only
enumeration of what documents exist. `updateIndex` awaits `initialize()`
specifically, by its own comment, so the index is never overwritten "with the
one or zero entries in the cold cache" — which covers the not-yet-initialised
case and did nothing for the failed-to-initialise one. `initPromise` memoised
the failure, so one transient timeout disabled the index for the life of the
page and the next `createDocument` wrote an index of one id over the real one.

### The fix that had the defect it was fixing

Round 596 narrowed two session writes to a single-session upsert and left FIVE
whole-list writers standing, in three other files. The correction for "a correct
fix applied in one of the places its mechanism appears" was itself applied in
one of the places its mechanism appeared. Every guard now sits on the single
method its call sites funnel through, so an eighth caller cannot bypass it.

### The rule that could not fail, twice

`every-localdb-reader-classifies-absence` is the test that should have caught
this whole family. Its predicate was
`source.includes('isGenuinelyAbsent')` — a substring test over the raw file.

1. A **comment** naming the function satisfied it. Adding a comment saying the
   *caller* does the classifying made a module look like it classified. This is
   the same shape as round 594's gate, which matched the example quoted in its
   own header.
2. Stripping comments was not enough. The control — removing every real call
   while leaving the import — came back **green**, because the **import line**
   alone satisfied the substring. A file could import the classifier, never call
   it, and pass.

It requires a call now, with imports stripped, and the control fails as it
should. The reader pattern was also widened from `FromLocalDB\(` to `FromDB\(`,
which is why `live-document-store` had been outside the rule entirely.

The lesson is narrower than "write controls": **run the control again after
fixing a broken check.** The first repair looked right and was still measuring
nothing.

## Round 603 — CI had not run for three hours

A monitor timed out waiting on two stacks. The stacks were not slow: across all
three repositories there were twelve queued jobs and **zero** executing, the
oldest queued for nearly three hours, with no other organisation repository
holding runners and GitHub reporting Actions operational.

Seven of the twelve were individual PRs the stacks supersede. Cancelling them
was safe only after checking, and the check mattered: one branch that looked
superseded by its name — `ci/stop-paying-for-the-same-work-twice` — is not an
ancestor of the stack and was left alone. Branch names are not evidence;
`git merge-base --is-ancestor` is.

Three runs started immediately afterwards. Whether that was causal or
coincidental with GitHub's scheduler is not established, and is recorded as
unknown rather than claimed.

The transferable point is about instrumentation: a monitor that waits for
completion cannot distinguish "running slowly" from "never started". Every push
during those three hours was adding to a queue that was not draining.

## Rounds 604-607 — four waves in which the checks were the defect

Four consecutive inspection waves found the same thing, and it is worth
separating from the ordinary run of bugs: **the gates were reporting safety
while measuring nothing.** Each was written by the same process that was
correctly finding real defects elsewhere.

| gate | satisfied by | what it was missing |
|---|---|---|
| readiness markers (594) | the example in its own header | a marker nothing prints |
| localdb absence rule | a comment, then an import line | five whole-collection writes |
| disconnect reports failure | an identifier the code had replaced | nothing — it was about to fail correct code |
| intent results checked | nothing at all: it matched zero sites | four discarded data-loss results |

The last is the purest case. It required `await \w+\.execute({`, and every call
site in the tree writes `deps.io.execute(`. So it evaluated **zero** sites and
printed "every failure-reporting intent is checked" on every run since it was
written. What it was missing: four `persist-pending-ops` results discarded in
`revfs-retry.ts`. `RevfsIO.execute` never rejects — a full disk, a revoked OPFS
handle, a serialisation error all arrive as `{ success: false }` on a resolved
promise — so a retry queue whose write failed was reported as queued, and the
user's operations were gone on the next reload.

### The rule this produced

It did not report "nothing matched". It reported success. **"OK" and "OK, 0
files considered" are indistinguishable at a glance, and only one of them is
true.**

So `check-gates-say-what-they-examined` now requires every gate's success line
to interpolate a value it computed. Eleven gates were rewritten to report
counts, and writing those counts found two things that reading the gates had
not:

- `check-image-fetches-retry` reported scanning ONE Dockerfile. That was a bug
  in the instrumentation, not the gate: `dockerfiles` is a function, so
  `.length` was its arity. It reads five. Instrumenting a gate can be as wrong
  as the gate.
- `check-listener-fanouts-are-isolated` reports 0 hand-rolled fan-outs across
  934 files. That reads alarming and is correct — the four files that do fan
  out are exactly the ones exempt as the guard itself. The line says so now,
  because a bare `0` cannot be told from a broken pattern.

One gate deliberately does NOT report a population count.
`check-sender-identity` greps for a forbidden shape rather than enumerating a
set, so a "handlers checked" number would exist only to satisfy the rule. It
reports files read, with that limit written into the line. A number invented to
pass a meta-gate is the meta-gate's own failure mode.

And the honest limit, stated inside the gate: interpolating a value is not
proof the value is meaningful, and a gate can still print a computed `0`. This
raises the floor. Per-gate floors — like the one added to
`check-intent-results-checked`, which now fails when it finds no `.execute(`
call sites at all — are what make a specific zero fail.

### On controls, twice over

Two lessons this stretch, both about the control rather than the fix.

**Re-run the control after repairing a broken check.** Stripping comments from
the absence rule looked like the fix; the control then came back green, because
the IMPORT LINE alone still satisfied the substring. The first repair looked
right and was still measuring nothing.

**A control is code, and it can be wrong in the direction that makes a working
fix look broken.** A control for the `wireMap` repair came back green and
nearly persuaded me the fix had failed. The control was at fault: its counting
regex did not allow for the generic in `wireMapValues<PeerEntry>(`, so it
reported zero remaining calls while one was still there. When a control
surprises you, verify the control before touching the fix.

## Round 608 — the fifth site, in the store the rule cannot see

`persistGroups` writes the whole group list for an account's key, and
`updateGroups` calls it on every change. `loadPersistedGroups` returned `[]` on
a failed IndexedDB read — another tab holding a `versionchange` open, private
mode, a version mismatch — so one arriving invite wrote a list of exactly that
group over every group the account had. The next reload shows one group, and a
bookmarked link reports "This group may have been deleted", which is the defect
`restorePersistedGroups` exists to prevent.

The old comment justified it: "A read failure is not 'no groups' — but ... the
live event stream still repopulates the list." That claim was load-bearing and
false. `reconcileGroups` is deliberately remove-only, because the wire carries
only a group key, and invites are not replayed. Nothing repopulates.

`resetGroupsForSession` already refuses to persist for exactly this reason,
forty lines away, in a comment that spells it out. The guard existed on one of
the two paths — which is now the fifth time this record has that sentence.

Fixing it made two existing tests fail, because they wrote before reading. One
of them would then have passed **vacuously**, asserting an empty list while
nothing had been stored at all; it asserts the write landed first now.

## Rounds 609-615 — the mechanism, closed at seven sites

**A whole-collection write performed from a collection that was never
successfully read.** Seven modules, twenty-three write sites, one shape.

| # | module | writers | how it failed |
|---|---|---|---|
| 1 | session upsert helper | 2 | one tab's list erased another's |
| 2 | peer-registration-store | 7 | a timed-out read deleted stored contact requests |
| 3 | live-document-store | 1 | one transient timeout made every document unlistable |
| 4 | connection session list | 5 | the fix for #1, applied to two of seven writers |
| 5 | group-conversations | 1 | an invite overwrote every group |
| 6 | RE-VFS retry queue | 4 | needed no read failure at all |
| 7 | auto-connect sign-outs | 3 | signing out of one account un-signed-out the others |

Every guard sits on the single function its call sites funnel through, never at
the call sites. Site 4 is why: it *was* the correction for site 1, and it
covered two of seven writers because it was applied where the bug had been
noticed rather than where the mechanism lived.

Two of these needed no failure to trigger. #6 wrote the whole retry queue on
three paths while never restoring — `restorePersistedOps` was reachable only
from the drain, so a reload while a peer was unreachable was enough. #7 is the
one a user would feel: a boot with a timed-out read, then signing out of one
account, auto-reconnected them into the others on the next boot, with stored
credentials, into accounts they had deliberately left.

### What the seven have in common

In every case the careful handling already existed somewhere nearby. #5's guard
was forty lines away in the same file, with a comment explaining exactly why it
mattered. #3's `updateIndex` awaited `initialize()` *specifically* so the index
would not be overwritten "with the one or zero entries in the cold cache" — it
covered the not-yet-initialised case and did nothing for the failed case. #6's
own header describes the loss it still permitted, as fixed.

## Round 616 — checks that could not fail, and the meta-check

Four gates were found reporting safety while measuring nothing, and the fourth
made the class worth addressing systemically:

| gate | satisfied by |
|---|---|
| readiness markers | the example quoted in its own header |
| localdb absence rule | a comment, then the import line |
| disconnect reports failure | an identifier the code had replaced |
| intent results checked | **nothing — it matched zero call sites** |

The last required `await \w+\.execute({` while every site writes
`deps.io.execute(`. It printed "every failure-reporting intent is checked" on
every run, for as long as it existed, while four discarded results let a failed
retry-queue write report as queued.

`check-gates-say-what-they-examined` now requires every gate's success line to
interpolate a value it computed, because **"OK" and "OK, 0 files considered"
are indistinguishable at a glance and only one of them is true.** Eleven gates
were rewritten to report counts, and doing so found two things reading them had
not: one reported scanning a single Dockerfile (an arity bug in the
instrumentation, not the gate — it reads five), and one reports zero
hand-rolled fan-outs across 934 files, which is correct and now legibly so.

One gate deliberately reports files READ rather than a population count. It
greps for a forbidden shape rather than enumerating a set, so a "handlers
checked" number would exist only to satisfy the meta-gate. A number invented to
pass a check is that check's own failure mode.

### Written while building a gate against a different defect

`check-debug-args-are-cheap` flagged, on its first run, the doc comment in
`debug-config.ts` that documents the hazard. That is the fifth instance of a
check satisfied by prose in this record, and the first written *while* fixing
another one. It reads code now.

It then turned out to have a second hole: it tested for the log call and the
expensive argument on the SAME line, so a call spanning three lines escaped —
and `router-diagnostics.ts` is exactly that shape, hashing every inbound
message in every tab. Reading the whole call found a third site nobody had
reported.

## Round 617 — the agents were told to click buttons that do not exist

Four of seven `.claude/agents/*.md` told the browser agent to click a "Join
Workspace" or "Login Workspace" button. The landing CTAs are `Sign In` and
`Create Account`, and the old copy survives in this repository only inside test
comments explaining that the suite was MIGRATED OFF it. The UI had learned
this; the agent docs never did.

These are the entry point for every other UI agent, so step 1 of four agents
could not be satisfied. One of them scripts the outcome: "Cannot find Join
Workspace button". The multi-user agent additionally asserted, as CRITICAL
CHECKs, a `/office` URL no route serves and a workspace name that appears
nowhere — so it could only ever report failure.

The master password was wrong in five places too: "found in kernel.toml as the
`workspace_master_password` field (currently SUPER_SECRET_…)". That file has no
such key — its header says the value comes from the environment — and the
quoted literal exists nowhere but a stale test report. An agent would have
opened the file, found nothing, and typed an invented password at a real
deployment.

`check-agent-docs-name-real-ui` enforces what can be enforced: a `data-testid`
must exist, and a `localhost:5291` path must match a route. Visible copy is
deliberately NOT checked — docs quote fragments, and an exact-match rule would
be noisy or defeated by rewording, which is exactly why the docs now name test
ids.

## Round 618 — an hour lost to a dependency that was never missing

`npm run build` died with `ReferenceError: crypto is not defined` inside
`@rollup/plugin-terser`, which reads as a missing terser dependency. It is not:
this machine runs Node 18 against a declared `engines: ">=20"`, and npm treats
that as advisory. README.md had described the failure, including the exact
error, for some time. Nothing prevented it.

`.npmrc` sets `engine-strict`, `.nvmrc` pins 20, and a gate requires all three
to agree — a floor declared in one place and enforced in none is not a floor.

## Round 619 — "I could not ask" is not "there is nothing there"

`remote.sessions()` is the agent's only way to ask the SDK which sessions and
P2P channels are live. Three call sites turned an `Err` into a benign default,
and each fed a branch that DESTROYS state on absence: removing the connection
map entry and running the SDK connect against a session the SDK may still hold;
removing a live claimable session and then denying the claim; dropping the peer
sink that message routing depends on. One said so in its own log line:
"assuming inactive".

The gate for it found ONE of the three on its first run. A fixed fourteen-line
window from `Err(` ran past the arm into the `if` that follows, whose branches
contain `return` — so it saw a return, concluded the failure was handled, and
excused the two sites it was written for. `check-disconnect-reports-failure`
carries a comment about the same bug. The arm is brace-matched now.

### On restores

The control for that gate left the tree in a state neither version had. The
three files were backed up by basename, and `requests/connect.rs` and
`requests/peer/connect.rs` collide — so one restore silently overwrote the
other, and the gate reported six sites instead of three, which is what caught
it. **Copies are not a restore mechanism when paths can share a name.** `git
checkout` is.

## Round 620 — the two repos each waited for the other, and both were right

The UI submodule's CI had one red check for several waves: `check-file-length.mjs`
reporting `remove 8 stale entr(y/ies) from SKIP`. Re-running it never changed
anything, because nothing about the UI branch was wrong.

Five jobs in the UI's workflow check the PARENT repo out to `parent/`, lay the PR's
code over `parent/citadel-workspaces`, and run the parent's build layout and gate
scripts against it. The parent ref was `PARENT_BRANCH: master`. So the UI's files
were measured against an allowance table checked out from the parent's DEFAULT
branch — and that table is keyed to the UI's own file lengths.

One table cannot describe two pointer states. The entries sized for the new UI code
read as "stale" against the old UI that parent `master` pins, and the gate's ratchet
(an exemption above a file's real length is a failure) fired — correctly. So:

  - the UI could not go green until the parent merged the new entries, and
  - the parent could not go green until it pinned the new UI files.

Neither order works. It is not a bug in either gate, and it is invisible as a CI
configuration problem: it presents as one confident, correct-looking red check.

The fix is in the coupling, not the ratchet. A `parent-ref` job resolves the parent
once, preferring a parent branch of the SAME NAME as the branch under test and
falling back to the default exactly as before, so the two halves of one change
validate against each other. Confirmed in a live run: `Parent … will be checked out
at 'master' (branch under test: 'stack/one-pass', fallback: 'master')` — correct,
because the parent branch was not pushed yet.

`check:parent-ref` guards it, and asserts BOTH halves, because either alone is
satisfiable while broken: a `needs:` with a hardcoded ref checks out the wrong
revision, and the resolved ref WITHOUT the `needs:` evaluates to the empty string,
which `actions/checkout` reads as "the default branch" — silently the original bug.
Three negative controls (hardcode one ref; drop one `needs:`; remove every parent
checkout) each turned it red; the restore was verified by hash, not by assumption.

### What the bump then exposed

Bumping the parent's pointer to the new UI is what the whole tangle was about, and
it had a second effect: **four parent gates had never once run against these files.**
The parent runs its gates against the revision it PINS, so every UI file added since
that months-old pin was unexamined by them, while CI looked green the entire time.

The one that mattered: `routeByCid` returns whether an instance actually claimed a
CID, and the orphan-buffer drain discarded it under a comment asserting the claim
could not fail. When it does fail the message is not lost — routeByCid hands it to
the leader — but a CID-routed notification processed by the LEADER instead of the
session it names is the wrong session, which is the entire failure
`CID_ROUTED_NOTIFICATIONS` exists to prevent. The drain is that message's last
chance: the fallback timer is already cleared and the entry is out of the buffer.
The boolean IS the comment's claim, tested; it is now read.

Also five untyped declarations, and two console listeners truncating at 200 chars
themselves — what `formatConsoleLine` exists to stop. The gate matched one of them;
the `pageerror` listener one line below did the same thing and was fixed in the same
pass rather than waiting to be found again.

### The WASM had not been buildable on this machine

`check-wasm-matches-its-source` was red, so `./sync-wasm-clients.sh` was the right
move — and it failed at `xcrun: unable to load libxcrun … (have 'arm64,arm64e', need
'x86_64')`. Not a broken Command Line Tools install: `~/.cargo/bin/wasm-pack` was an
**x86_64 binary**, so it ran under Rosetta and every child down to `cc` and `xcrun`
inherited x86_64, while the CLT dylib is arm64-only. `arch -x86_64 /usr/bin/xcrun`
reproduces the error exactly. Reinstalled at the SAME version (0.13.1) so the
architecture was the only variable.

Worth noting what this means: the documented WASM rebuild path had been silently
unusable locally, which is precisely the condition under which a stamp gate is the
only thing standing between a source change and a browser running a binary without
it.

### Two of my own mistakes, both the same shape

`cargo install` reported success when it had refused (`binary already exists`) —
I read `tail`'s exit status, not cargo's. The same shape as the earlier `&&`-chained
`cargo fmt && clippy`, where the chain short-circuited and the status belonged to the
wrong command. **After a pipeline or a chain, `$?` is not the answer; the log is.**

## Round 621 — a deploy that ignored what was tested, and three gates that could not see

Four read-only inspection sweeps (developer experience, robustness, performance,
test quality) against the CURRENT branch heads rather than `master`. Acted on four
findings this round; the rest are triaged below.

### The deploy discarded the pointers it had just pulled

`update-avarok-server.sh:10` ran `git submodule update --remote --recursive` on the
live server, one line after `git pull`. `--remote` deliberately IGNORES the commit
the superproject records and takes each submodule's configured branch tip instead —
`master` for the agent because `.gitmodules` names it, and the remote's default
branch for the UI because it names none.

Neither branch is where the work is. When this was found, `origin/master` was **118
commits behind** the agent's active branch and 42 behind the UI's. So the server was
rebuilt, successfully and with nothing in the output naming what shipped, from an
agent months older than the commit it had just pulled. The recorded pointer IS the
statement of what was tested; resolving it against a moving branch deploys something
nobody validated.

Every other invocation in the tree already used `--init --recursive`. This was the
one that did not — the dominant defect class here, in the one place where it reaches
a machine other people would be testing on.

`check-deploys-use-the-recorded-pointers.mjs` closes it across scripts, workflows,
Dockerfiles and docs. Its own first run flagged the CI step's comment explaining the
fix, so comments are exempt in EXECUTABLE files only: a comment there cannot run,
while prose in a runbook is the instruction, which is how this reached the server.
Controls: the original defective line, a fresh `--remote` in a shell script, prose in
a doc, and a vacuity floor — all red.

One of those controls then destroyed the fix. `git checkout -- docs/COMMIT_PUSH_SCRIPTS.md`
reverted the file to HEAD, and HEAD still held the defect this round was fixing, since
it was not yet committed. The gate going red is what caught it. **git checkout is not
an undo for a control when the file also carries uncommitted work** — a lesson this
record already contains, relearned.

### Three gates that had never looked at half the tree

- **`check-no-nested-npm-ci-in-workspaces`** read only the parent's own workflows.
  The submodule's lint job ran `npm ci && npm run build` inside
  `citadel-internal-service/typescript-client` — a member of the ROOT npm workspace —
  re-resolving it from a nested lockfile (uuid 9.0.1, ws 8.18.3 against the root's
  13.0.2 and 8.21.3) and unhoisting the root devDependencies. Two later steps existed
  only to undo that: a pinned `npm install eslint@9.39.2` over the lockfile, and three
  `ln -sf` calls restoring what node resolution would have found anyway. This record
  already claimed that `eslint@9.39.2` line had been deleted; it had been, in one repo
  of two. Verified before removing all three: with a plain root `npm ci` and none of
  them, the member resolves all four packages from the root and eslint exits 0.
- **`check-specs-search-for-real-copy`** could not check the locator form it
  RECOMMENDS. `member-list-loading.spec.ts` searched for `/No members yet/i`; the
  sidebar has always said "Nobody else is here yet", so `sawEmptyState` was
  structurally false and `expect(sawEmptyState).toBe(false)` — the one assertion the
  spec exists for — could not fail.
- **`check-gates-say-what-they-examined`** (reported, not yet fixed) reads only the
  parent's `scripts/`, so 43 UI gates are unexamined and 7 violate its rule.

### The gate's own controls found two faults in it

Widening the copy gate to testids, the first control did NOT fire: changing the spec's
id to `members-empty-nonexistent` still passed, because the matcher admitted any id
that merely EXTENDED a known one. Now only *templated* prefixes may be extended. And
reading only the JSX attribute form, it accused three specs over `preview-region-sidebar`,
which `ThemePreview.tsx` renders as an object property — a check that invents findings
gets disabled, and then catches nothing.

Its limits are now written into it. It still cannot tell WHICH SCREEN a string is on:
restoring the original `getByText('No members yet')` is reported clean today, because
the app does contain that sentence, on another page. Only the testid closes it.

### A green suite that exited 1

The unit-tests job failed with **3098 passed, 0 failed**. Sonner arms a `setTimeout` to
remove a dismissed toast, and nothing cancels it when the Toaster unmounts; the last
test in `PwaUpdatePrompt.test.tsx` finished with one pending, vitest tore the jsdom
environment down, and the timer fired into nothing — `setToasts` reaching react-dom's
`getCurrentEventPriority`, which read `window`. A red run naming a file whose every
test was green, pointing at react-dom internals. Fake timers make it impossible rather
than unlikely. Measured while writing it: the flush does not reach zero pending, and
the comment says so instead of claiming a clean sweep.

### The onboarding answer did nothing

`onChoose` and `onDismiss` were both wired to the same zero-argument `resolve`, so
"setting up a workspace", "joining one" and closing the dialog were indistinguishable.
The dialog tells a member they "do not need the master password, and should not be
asked for it", and one screen later `WorkspaceInitializationModal` asks them for it.
Answering "joining" now suppresses that prompt — the same suppression dismissing
already performs, so no new state. Its first negative control silently applied to the
WRONG function (`request` ends in the same two lines as `resolve`) and had to be
redone; the control was verified as applied rather than assumed.

### Triaged, not yet acted on

Robustness: ILM's write ack accepts ANY response as success, including the agent's own
refusal (`backend.rs:198,551`) — high; group owner's accept/decline answers success
without asking the protocol (`respond_request.rs:113`); follower claim TTL (30 s)
outlives the whole retry budget (~20 s); startup force-clears its concurrency flag
after 100 ms; file-transfer is the only CID-routed family with no session filter;
`PeerRegisterNotification` handled twice, once unfiltered.

Performance: every document save rewrites the entire node corpus under the global lock;
`GetUserPermissions` fetches the full node blob 54×; the ILM queue is one blob re-read
and rewritten ~9× per message; media frames ride the decimal-array JSON path at 3.57×;
every keystroke re-renders every bubble, each building an `Intl` formatter.

Test quality: `file-transfer.test.ts` gates only on "sendFile threw anything"; the
server kernel's 79 integration files never touch the real backend; the C2S byte check
runs in an un-joined task; `hosted-ui-loopback.spec.ts` is permanently skipped and its
driver does not exist; `LEADER_MUST_PROCESS_LOCALLY` is consumed by both routers and
tested by nothing.

## Round 622 — the production server did not compile, and 121 gates said it was fine

### A refused write reported as a stored one

The messenger backend persists the queues that make messaging durable: the
outbound map, the inbound map, the delivery frontier, the next-id counter. Five
call sites answered "did that work?" in four different ways.

`update_map` and `store_value` used `wait_for_response(id).await.is_some()` — the
PRESENCE of a reply. A `LocalDBSetKVFailure` is a reply, and the agent sends one
on a backend error, on a failed `propose_target`, and on the ownership-gate
refusal, with `request_id` populated so it routes straight to the waiter. So a
refused write returned `Ok(())`, `backend_map::mutate` reported the map stored, ILM
reported the message queued, and the sender saw it as sent. Nothing retransmitted
it on reload.

The comment under each branch claimed to prevent exactly that, and
`store_values_batched` — which does match the variant — says all three "must agree
with" it. They never did.

The read side had the mirror fault: `load_values_batched` folded every non-success
into `None`, so a backend error read as "no such key" and `MessageTracker::new`
starts with an empty delivery frontier — re-delivering messages already received,
resetting ACK state, restarting the id counter, on an error that should have
failed initialisation.

Grepping the mechanism rather than the reported symptom found a third the sweep
had missed: `load_value` had BOTH faults, its timeout branch returning `Ok(None)`
under a comment saying "assume the key doesn't exist".

Both decisions are now one pure function each — `write_outcome`, `read_outcome` —
so the five sites share one answer and the classification is testable with nothing
mocked. Controls: `Some(_) => Ok(())` reddens exactly the refusal and wrong-variant
tests; `_ => Ok(None)` reddens exactly the failed-read test. `KEY_NOT_FOUND` moved
into the shared types crate: it was typed out in two crates and compared with `==`,
so a reword on either side would silently invert the meaning with no build failure.

### The server image had not compiled since the security fix landed

Two Playwright shards failed at "Start Services". The cause, six log-levels down:

    error[E0432]: unresolved import `sha2`
      --> citadel-workspace-server-kernel/src/kernel/secret_eq.rs:20:5

`docker/workspace-server/Dockerfile:62` COPIES a Docker-specific manifest OVER the
crate's own `Cargo.toml`. It exists for a real reason — dropping dev-dependencies
that would unify `localhost-testing` into a production build — but it re-declares
the whole `[dependencies]` table by hand. The constant-time master-password
comparison added `sha2` and `subtle` to the crate and not to the copy.

So `cargo build`, clippy, the tests and all 120 gates passed, and the production
server image could not compile. **The machine this stack is being stood up on was
unbuildable, and nothing in the repository said so** — it surfaced as a Playwright
job failing to start services, a message naming neither the crate, the dependency,
nor the manifest.

`check-docker-manifest-matches-the-crate.mjs` compares the two `[dependencies]`
tables wherever a Dockerfile substitutes a manifest. Its own first run invented a
fault — the same Dockerfile also substitutes the WORKSPACE ROOT manifest, and
matching the last path segment turned that into a crate called "app" — which is
how a useful gate gets switched off. Controls: removing the two deps again names
both, with the exact `unresolved import` the image produced; an extra dep is caught
too; a vacuity floor covers the COPY line being reworded.

### The sync script rewrote the lockfile, and then lied about it

`sync-wasm-clients.sh` runs `npm install` inside two workspace MEMBERS. npm walks
up, so each rewrote the ROOT `package-lock.json`: renaming the package to the
checkout directory and dropping 406 lines of platform-optional @esbuild/@rollup
entries that every OTHER platform needs. Reverted twice this session before the
cause was looked for. A third install site in the same file already carried
`--package-lock=false` — the fix had reached one of three.

Adding the flag to the other two stops the file being corrupted, and then does
something subtler: it resolves FRESH, so the tree ends up holding whatever the
registry served today while the lockfile still claims otherwise. Verified
immediately: typescript 6.0.3 installed at the root against a lockfile pinning
5.9.3, and `tsc` failed on a deprecation this repository has not adopted. The
script now ends with a root `npm ci`, which is the repair I had already performed
by hand twice, and which the existing hand-patch three steps above it — deleting
"the Playwright copies this install just placed here" — is a single-package
version of.

Also removed two preflight entries duplicating gates it already DERIVES from
validate.yml, which is why one fault printed as two failures.

121 gates green, and this time that includes the server image's dependency list.

## Round 623 — a default that published the agent, and a gate that passed the worse drift

Four sweeps: developer experience, robustness, performance, security. Acted on three
security/robustness findings; the rest triaged below.

### The agent image bound to every interface by default

`docker/internal-service/Dockerfile` CMD carried
`--bind ${INTERNAL_SERVICE_BIND_HOST:-0.0.0.0}`, in BOTH runtime stages.

The agent holds decrypted P2P plaintext and an unauthenticated control plane:
anything that can open a socket to it can claim an orphaned session, read another
account's persisted store, and deregister the account. It is loopback-only by
design, and that is a standing instruction on this work.

Every compose file in the repository sets the variable explicitly — which is why
`check-agent-binds-loopback.mjs` was green. It read `docker-compose*.yml` and
nothing else. So the default applied exactly where no compose file was involved: a
bare `docker run` of the published image, a new compose file, a mistyped variable
name. Those are the cases with no reviewer, and the gate reported the image as
loopback-only throughout.

**A default has to be safe when the operator changes nothing.** Now `127.0.0.1`, and
the gate reads the image's CMD as well as the compose files. Controls: the exact
historical `0.0.0.0`, a non-loopback default in one stage only, and the CMD being
restructured away — all red.

### The master-password oracle, in the sibling of the function already fixed

`create_workspace` compared the root master password BEFORE checking whether the
caller may create workspaces. Whichever check runs first owns the error the caller
sees, so the two distinct messages answered the guess:

    "Invalid workspace master password"                     -> wrong
    "Only root workspace admins can create additional ..."  -> RIGHT, wrong caller

`update_workspace` had exactly this and was fixed in an earlier round, with a long
comment explaining it. The comment did not reach the function 300 lines above it.
Making the comparison constant-time did nothing about either: timing was never the
leak, the answer was being returned as text.

`check-authorization-precedes-the-secret.mjs` now requires an authorization check
textually before every `secrets_match`. Two things it taught immediately:

  - Its first parser, a brace-depth splitter, found ZERO call sites. Rust bodies
    carry braces in string literals, `format!` placeholders and doc comments, so
    counting them is guesswork. **Only the vacuity floor caught it** — a gate that
    silently examines nothing is the failure this repository keeps re-finding, and
    this time it was mine. Rewritten to walk backward to the enclosing signature.
  - On its first working run it found a FIFTH site nobody had reported:
    `inject_admin_user`. That one is legitimate — it is the boot sequence, with no
    caller to authorize and nothing returned to anyone — so it is now annotated
    saying so. The exemption must be written down, so the next reader can check
    whether it still holds.

### The gate written an hour earlier passed a worse drift than the one it caught

`check-docker-manifest-matches-the-crate.mjs` compared dependency NAMES. The same
Dockerfile also substitutes the WORKSPACE ROOT manifest, and a virtual root
declares no `[dependencies]` — so that pair passed **vacuously**, over a file the
gate had effectively not opened.

What it missed: the root `Cargo.toml` sets `[profile.release] overflow-checks =
true`, under a comment calling it "the point of this block" — Cargo has the checks
ON for `cargo test` and OFF for `--release`, so without them an integer overflow
panics in CI and wraps silently in the shipped binary, in a codebase of u64 CIDs,
counters, byte offsets and quotas. The Docker root manifest had no `[profile.*]` at
all. The server users would run was compiled with the checks off, while the agent
image — which copies the real root — was not. **Two shipped binaries doing
different arithmetic.**

The gate now compares `[profile.*]` as whole key/value pairs, so a table that
exists but sets something else fails too, with a floor that refuses to pass when it
compares zero settings.

### Triaged, not yet acted on

Security: any page in the allowed origin can claim an ORPHANED session with no
proof and then act as, read, or delete that account (`connection_management_auth.rs:64`)
— highest remaining; MDX integrity fails open (`mdx-integrity.ts:54` returns
`unhashed`, treated as verified) while the CSP allows `unsafe-eval` and the server
writes `mdx_content_hash: None` almost everywhere; `LocalDBGetKV` is not in
`requires_owned_session`, so another account's persisted store — including queued
P2P payloads — is readable; group roles exist only in the browser and the agent's
`GroupKick`/`GroupInvite`/`GroupEnd` have no role check; the production UI image
resolves every dependency from the live registry with no lockfile;
`MessageNotification` derives plain `Debug`, so decrypted bodies reach the log one
level away.

Robustness: a failed username read is stored as `#INVALID_USERNAME`, disabling the
duplicate-session guard; `Deregister` is not in `requires_owned_session`; one
undecodable frame ends the whole inbound stream (`connector.rs:46`); ILM init reads
a failed pending-inbound query as "nothing pending" and ACKs undelivered messages;
batched loads map responses to keys positionally with no count check; leader
promotion replays queued requests before the outbound handler is active; six
`is_admin` gates still refuse the Owner; the WASM staleness stamp omits ILM.

Performance: broadcast fan-out re-authorises per recipient with three corpus copies
each and drops on `Lagged`; `nodes_cache` still pays O(corpus) per permission check;
the production filesystem backend serialises the whole store per write; every
activation re-downloads the full corpus including document bodies.

## Round 624 — a disconnected account's store, and a regression I shipped into CI

### The ownership gate let an unmapped session through, and two things went with it

The gate lets an unmapped cid proceed, on the stated grounds that "the handler
owns that error and already reports it". That holds for a cid naming an UNKNOWN
account: `propose_target` fails and the handler answers honestly.

It does not hold for one that is KNOWN and merely has no live session — after a
Disconnect, or an agent restart while the browser keeps its cid. `propose_target`
succeeds there; by its own doc it checks only that the cid names a locally-known
account, never that the caller owns it. So `LocalDBGetKV` handed that account's
stored ILM payloads — `inbound_messages-<cid>` and everything the UI persists per
account — to any connection able to name the cid. A cid is a u64 that travels in
peer lists and `GetSessions` responses; it is not a secret, and the agent's
WebSocket has no CORS to stop a page opening it.

`Deregister` is the same shape with a worse ending: its handler never consults the
map, so an unmapped cid deletes the account permanently. The comment on `handle`
already lists it among the operations that "are gated now" — it was gated only
against a session held by SOMEBODY ELSE, never one held by nobody.

Gating the read was only possible after removing what blocked it. `LocalDBGetKV`
sat in the silent-refusal list under the reason that the queries "return DATA, and
their response types carry no failure variant". True of `GroupListGroupsFor`; never
true of this one — `LocalDBGetKVFailure` exists and the handler already builds one.
**The false premise was load-bearing**: silence is why the variant could not be
gated, and not being gated is what left the store readable.

Two existing tests asserted the old behaviour. They were pinning the hole, so their
REASONING was replaced rather than their assertions flipped, and a third was added
as their control — an owned session still reads, so a gate that refused reads
outright could not pass by refusing everything.

### A regression I introduced, found by CI within the hour

Last round's addition of a closing `npm ci` to `sync-wasm-clients.sh` took down
every "Start Services" job:

    npm error The `npm ci` command can only install with an existing package-lock.json

The sync CONTAINER mounts three subtrees and not the parent's lockfile, so
`/workspace` has no root lockfile at all. The fix I wrote for a host checkout was
unconditional. Now guarded on the lockfile existing, which is the actual
precondition rather than an assumption about where the script runs.

Worth stating plainly: that was a fix for a real problem which introduced a worse
one, and it was caught only because CI runs the container path. The error message
at least named the tree and the command to run — which is why the diagnosis took
one log read rather than a bisect.

### The stamp did not cover ILM, and the fix removed a fourth copy

`wasm-source-trees.txt` listed three trees. The wasm-client depends on the
connector, and the connector depends on intersession-layer-messaging — so ILM is
compiled INTO the binary the browser runs, and a change to the reliability layer
left the stamp unchanged. Exactly the failure the file's own header describes for
the connector, one dependency further down.

Adding it surfaced three more things:

  - ILM is a NESTED submodule, so `rev-parse HEAD:intersession-layer-messaging/src`
    fails outright; the GITLINK is the content identity, and it is what the list
    now names.
  - The staleness gate's "cannot read the source" branch threw
    `ReferenceError: SOURCE_DIR is not defined` — the one path whose job is to say
    "this check could not run" was the one path that could not say it.
  - `build.rs` held a FOURTH hand-copied list, "kept in step" by a comment and by
    the trigger gate. Rather than adding a fourth copy of ILM, build.rs now READS
    the shared file (with a `rerun-if-changed` on it, or embedding it would freeze
    a stale copy). The gate accepts that as the stronger form.

And the trigger gate then failed its own control: with the trigger removed it
stayed green, because `buildRs.includes('intersession-layer-messaging')` was
satisfied by the COMMENT explaining the rule. **A gate a comment can satisfy has
the same shape as the bug it hunts** — the copy gate strips comments for this
reason, and this one now does too. Only after that does removing the trigger
redden it.

## Round 625 — the plaintext the agent exists to protect was in the log

`kernel/ext.rs` logs every response with `debug!("Sending kernel response to
client: {:?}")`. That is a reasonable thing for it to do, provided the types
redact what they carry.

`MessageNotification.message` did not. It is the DECRYPTED body of a peer-to-peer
message, it was the only `Vec<u8>` in the wire types with no debug formatter, and
`RUST_LOG=debug` is the first thing an operator raises when diagnosing delivery.
So the full plaintext of every message the agent handled went to the log, and from
there to whatever collects it and to whatever gets pasted into an issue.

### The obvious fix was the wrong one

Every other byte field uses `bytes_debug_fmt`, which prints the length and the
first and last five bytes. That is the right trade for a key, a ratchet sample or
a file chunk: it identifies the value without disclosing anything usable.

It is the wrong trade for a message body. Five bytes of a chat line is its opening
word, and a log holds a great many opening words. `plaintext_debug_fmt` prints the
length only — enough to distinguish an empty body from a truncated one from a
whole one, which is the question a delivery bug actually asks, and no more than
the ciphertext length already discloses.

The test is what forced that distinction: it failed against the "fixed" code, and
the right response was a stronger formatter rather than a weaker assertion.

`GroupMessageNotification.message` gets the same treatment — the same material,
reaching more people, and it carried the sampling formatter.

### An assertion of mine that no input could falsify

The first test asserted the body's ASCII was absent from the Debug output.
`format!("{:?}")` of a `Vec<u8>` prints decimal numbers, never characters, so a
completely unredacted field contains no ASCII to find. **It passed with the
formatter deleted.** Only the negative control showed it; reading the test would
not have. It now compares against the decimal rendering, and all four body tests
go red when the formatters are removed.

A second control also revealed that an earlier edit had reached
`GroupMessageNotification` incidentally — the replacement had no count and matched
two structs. The change was right on the merits, so it is now deliberate,
commented and covered rather than accidental.

### The gate found two more fields, and they were fine

`password` and `proposed_password` are `SecBuffer`, which implements `Debug` as
`***SECRET***`. So the gate exempts that type — a gate that reports faults it
invented is a gate somebody switches off — and a test in the types crate pins the
SDK behaviour the exemption rests on. An exemption is only as good as the
dependency it trusts, and that dependency is now watched rather than assumed.

### Verified from the previous round

The two repairs to `sync-wasm-clients.sh` held across a full rebuild: the root
lockfile is unchanged (still 23 platform-optional @esbuild entries, still named
`citadel-workspace`), and the tree came back on the pinned typescript 5.9.3 rather
than the freshly-resolved 6.0.3. Both were failures that had to be repaired by
hand twice before the script was made to do it.

123 gates green.

## Round 626 — the SSOT fix broke the build in the other place it builds

Round 624 replaced `build.rs`'s hand-copied list of WASM source trees with
`include_str!("../scripts/wasm-source-trees.txt")`. That removed a fourth copy of
one fact, which was right, and broke every "Start Services" job in CI, which was
not:

    error[E0282]: type annotations needed
      --> citadel-workspace-internal-service/build.rs:37:19
       |
    37 |         let dir = line.trim();
       |                   ^^^^ cannot infer type

`include_str!` is compile-time and hard-fails when the file is absent — and it IS
absent in the Docker images, which copy specific crates and never `scripts/`. The
macro failed, so `line` had no type, and the error named type inference rather
than a missing file. The server image built fine; the agent image did not.

**A build script that requires a file outside the copied tree only works in one of
the two places it runs.** `fs::read_to_string` degrades instead: where the list is
present — a host checkout, which is where incremental rebuilds matter — the
triggers come from it; where it is not, the script warns and continues, and those
builds are one-shot with `SKIP_WASM_BUILD` set anyway.

It warns rather than passing silently because a missing list on a HOST checkout is
a real fault — an edit to the P2P send path would rebuild nothing — and the script
cannot tell the two cases apart. The gate now requires that warning to exist:
degrading quietly is the same defect wearing a friendlier face.

Verified the way it should have been the first time: the build script was compiled
in BOTH contexts, in a throwaway crate. List absent — compiles, warns, continues.
List present — compiles clean. That check takes thirty seconds and would have
caught this before the push.

### Two regressions in three rounds, both from improvements

Round 623's `npm ci` and round 624's `include_str!` were both correct fixes to
real problems that failed in the OTHER environment. The pattern is the same one
this record keeps finding in other people's code: a change verified in the place
the author was standing, and not in the place it also runs.

The generalisable habit is not "be more careful". It is: when a change touches
something that runs in more than one context — a script that runs on a host and
in a container, a build script compiled in a checkout and in an image — exercise
BOTH before pushing. Both were cheap to exercise, and neither was.

## Round 627 — one bad frame, and a placeholder that defeated its own guard

### A single unreadable frame ended the inbound stream

`WrappedStream::poll_next` was `_ => Poll::Ready(None)`, which collapsed three
different things into "the peer hung up": a genuine end of stream, a frame that
failed to decode, and a `Request` arriving where a `Response` belongs.

The middle one needs nothing to be broken. There is no `#[serde(other)]` anywhere
in the wire types, so an agent one release ahead of the client emits a variant the
client cannot parse. That ended the messenger's inbound task, which the TypeScript
client reads as "Stream closed" — restarting the socket and clearing every
messenger handle. One unknown frame per restart, dead after three, and nothing in
the log said a frame had been dropped.

The WASM read loop already skips such items and keeps reading. This was the same
decision one layer down, where nobody had made it.

Skipping FOREVER is the opposite mistake, so 64 consecutive unreadable frames still
end the stream, with a message saying it is a decoder or version mismatch rather
than one bad message. A decoder that can read nothing is a different fault, and
that is where the two stop being treated the same. The test for it is a 200-frame
flood that must still terminate — without it, a version that skipped everything
and never returned `None` would satisfy the other tests and hang every consumer.

The test double implements the real `IOInterface`, so what runs is the real
`WrappedStream` over a real `Stream`; the only invented part is a stream that can
yield the `Err` `InMemoryStream` cannot produce.

`WrappedStream::new` is now the only constructor — the counter has to start
somewhere, and there were three construction sites across two crates.

### A placeholder that defeated the guard it fed

`connect.rs` read the username as
`.ok().flatten().unwrap_or_else(|| "#INVALID_USERNAME")`. The session is RECORDED
under that value, and GUARD 2 compares the next Connect's username against
`conn.username` — so a session stored under the placeholder matched nothing, the
guard saw no existing session, and a second SDK connect ran against a live one.
That is precisely the ratchet reset GUARD 2 exists to prevent.

**The identical fix already sat fifteen lines below**, on the `server_address`
read, with a comment explaining exactly this reasoning. It did not reach the read
three lines above it. That is the dominant defect class in this tree, appearing
this time inside a single function.

One cleanup site had the matching fault: it ran AFTER the SDK-derived `username`
shadows the request's, so it removed the wrong key from `connecting_usernames` and
left the request's username in the set — GUARD 1 then refusing that user every
attempt until the agent restarted. The other two exits already used
`username_for_cleanup`.

`check-session-query-failures-are-not-absence.mjs` now covers
`get_username_by_cid`. Three observations, in order: against the pinned tree it
reproduces the historical defect with no plant needed; against the fixed tree it
passes; and reintroducing the combinator chain reddens it again. The third is the
one that matters — a gate that passes because it stopped looking is
indistinguishable from one that passes because the code is right, and only the
reintroduction tells them apart.

## Round 628 — two silent losses in the delivery frontier

Both are the same shape as the ILM write/read classification fixed two rounds ago,
in the two places that decide what has already been delivered.

### A failed pending-inbound read meant "nothing is pending"

`MessageTracker::new` seeds its delivery frontier from `last_received_from`, but
only for peers with NOTHING still pending inbound — for those, everything received
was delivered by definition. The comment on that seed says exactly this, and names
the test that catches the alternative.

`get_pending_inbound().await.unwrap_or_default()` defeated it four lines later. A
FAILED query yields an empty vec, which reads as "no peer has anything pending", so
the seed was applied to every peer. A message received but not yet delivered was
then claimed as delivered — ACKed, cleared, never retransmitted. **The guard and
the thing that defeated it were four lines apart.**

`new` already returns `Result` and its only production caller uses `?`, so refusing
costs nothing.

An existing test, `test_backend_error_handling`, constructed ILM over a backend
that failed EVERYTHING and unwrapped it — so once construction refuses, it can no
longer reach its own subject. It was split rather than weakened: its subject is a
backend that cannot WRITE, so its pending-inbound read now succeeds, and the new
property has its own test with a control asserting an empty but READABLE backend
still starts. Without that control, refusing construction unconditionally passes.

### A short batched reply was mapped to the wrong keys

`load_values_batched` mapped responses to keys positionally with no length check.
Its twin `store_values_batched` refuses a short reply and says so; this one instead
papered over the possibility with `keys.get(index)` falling back to `"<unknown>"`.

A short array is reachable — the agent assembles a batch response with `filter_map`,
dropping any sub-command whose handler answered nothing — and every value after the
gap is then attributed to the wrong key. That is not a visible error:
`MessageTracker::new` loads six keys, five of them `HashMap<u64, u64>`, so
`last_acked` deserialises perfectly from `last_sent`'s bytes. The frontier comes out
built from the wrong counters — re-minted ids, re-delivery, duplicates swallowed as
already-seen — with nothing anywhere reporting a fault.

The refusal work earlier in this branch removed one way for the batch to come back
short; this makes the remaining ways loud.

### The ILM gitlink earned its place

This is the first round where a change confined to intersession-layer-messaging
made the WASM stamp go stale. Before round 626 added the gitlink to
`wasm-source-trees.txt`, an ILM-only change left the stamp untouched and the gate
reported a freshly-built binary containing none of it. The mechanism was added on
reasoning; this is the observation that it works.

### CI, for the record

The UI run reached 13 green with its three failures at **"Run Integration Test"**
rather than "Start Services" — the first time since the Docker manifest defect that
the stack builds and starts, and therefore the first real test signal. The three
are `reconnect-p2p-only`, `reconnect-both-c2s` and `reconnect-one-c2s`, unread as
of this entry.

## Round 629 — the first real test signal, and what it turned out to say

The UI run reached 13 green with three failures at "Run Integration Test" rather
than "Start Services" — the first genuine test signal since the Docker manifest
defect. `reconnect-c2s` passes; `reconnect-p2p-only`, `reconnect-one-c2s` and
`reconnect-both-c2s` fail. `prev-sessions`, `group-multiuser` and `permissions`
also pass, so LocalDB reads and the ownership gate work generally.

### They are not a regression from this branch, and that is established, not assumed

Run 34012041535 (04:39Z) shows the same two specs failing. The earliest agent
commit in this wave is 09:24Z — **five hours later**. That run also has no
"Resolve parent ref" job, confirming it predates the CI change too. These
failures pre-date every change made here.

### And they are not about reconnection

Reading the log rather than the name: both accounts are created, both enter the
workspace, `P2P registration request sent` at 12:27:19, and the invitee's pending
badge never appears through 12:28:23. The wait is 20 attempts at 2s, so ~40s of
polling and 63s wall-clock — not impatience. **The spec fails in its SETUP, before
any reconnect happens.** The name says reconnection; the failure is initial peer
registration not surfacing on the invitee.

That is the next investigation, and it now starts from a located symptom rather
than three red job names.

### A capture list doing double duty

The same log showed three `[ILM-Router] Registering CID <n> for self (leader's own
connection)` lines reported as `critical/functional` UX failures. The app logs them
with `debugLog`, which is `console.log` — the misclassification is in the harness.

`errorPatterns` contains `'ILM'` deliberately: it is the CAPTURE list, and a
delivery failure with no ILM lines has nothing to diagnose from. Four of the five
reconnection specs then reused it as the FAILURE list, so every line worth
recording became an error the run did not have.

`c2s-reconnect.test.ts`, in the same directory, already separated the two. Once
again the correct implementation was one file away from the four that had not
adopted it.

`check-captured-is-not-failed.mjs` requires the two decisions to be made
separately. It deliberately does not judge either list's contents — a spec may
decide what counts as a failure for itself — only that "what should I record" and
"what counts as broken" are not answered by the same array.

The cost of getting this wrong is not the noise. It is that a reader who sees
three CRITICAL entries that are not critical stops reading the list, and the run
where one of them is real looks identical.

## Round 630 — the documented way to deploy avarok could not start the server

Two scripts point at the production host, and both are what an operator reaches
for. Neither could work, and each layer reported something true while none
reported the cause.

`update-avarok-server.sh` and `restart-remote-server.sh` both ran:

    docker build --network=host -t citadel-workspace-server \
                 -f docker/workspace-server/Dockerfile .

No `--target`, so Docker builds the LAST stage in that file — which is `dev`
(`FROM builder AS dev`), the toolchain image, not `production`. It also compiled
Rust on the production host, a practice `deploy.sh` removed on purpose.

Then:

    docker run -d --restart unless-stopped citadel-workspace-server

No `WORKSPACE_MASTER_PASSWORD` and no env file. The kernel refuses to start
without one — `citadel-workspace-server-kernel/src/main.rs:49`,
"workspace_master_password is required" — so the container exited immediately,
and `--restart unless-stopped` turned that into a loop.

The script then ran `nc -zv 127.0.0.1 12349`, which failed, and told the operator
**the port was shut**. A missing environment variable presented as a network
problem, three layers from its cause.

### Why fixing them in place would have been the wrong repair

`deploy.sh` already does this job properly: it reads `.env` and refuses a
`__CHANGE_ME__` master password before touching anything, pulls prebuilt images
from GHCR instead of compiling on the host, verifies every image came from the
SAME commit, and restarts services without touching the data volumes.

So these were a second answer to a question that already had one — and adding
`--target production` and an env file would have kept a duplicate deploy alive
while recreating the host-side Rust build that `deploy.sh` deliberately dropped.

They now keep only the part that was genuinely theirs — knowing which host, where
the checkout is, and (for the second) uploading a specific `kernel.toml` — and
hand off. `restart-remote-server.sh` also loses `git reset --hard origin/dev-next`:
that branch does exist, which is not the problem; deciding for the operator,
destructively, on a production host, is.

### The gate, and what it deliberately does not do

`check-deploy-paths-can-start-the-server.mjs` covers the top-level operator
scripts only. Compose files and CI workflows are exempt on purpose: compose
supplies `environment:` from the file, and CI builds with explicit targets and
runs the dev stack deliberately. This is about the commands a person types at a
production host, which is where missing configuration goes unnoticed.

Three controls: the original untargeted build is caught; the original configless
`docker run` is caught; and a `docker run --env-file .env` still PASSES — so the
gate discriminates rather than banning the verb, which is the difference between
a rule and a superstition.

124 gates green.

## Round 631 — four assertions no input could falsify

An audit of the Playwright specs found four, each with a plausible reason to be
there. Recorded together because the shapes differ and the lesson is the same.

**The reload half of the clear-history test.** `p2p-messaging.spec.ts` asserted
the cleared message was absent after a reload, under a comment saying that is
"the half that proves the PERSISTED pages were deleted". `toHaveCount(0)`
immediately after a reload is true before anything renders — and this test clears
the WHOLE transcript, so there is no surviving message to wait for either. Delete
the on-disk removal in `lib/p2p/message-page-delete.ts`, keep only the in-memory
clear, and it stayed green.

It now sends a message after the reload and waits for it to arrive. That proves
the composer, the store and the list are working again, so the absence that
follows is a statement about the data rather than about the timing. **The
"waiting for absence passes instantly" entry in this record is what this is; it
had not been applied to the specs.**

**`expect(created).toBeTruthy()`** where `createRoomViaUI` returns
`{ success, name }`. An object is always truthy, so it held when the helper
reported failure — and a comment twelve lines above documents exactly this trap
for the sibling call.

**`expect(url).toContain('/workspace')`** after navigating to an office. Already
true before the click: login waits for `/workspace`, and the office view lives
under the same route. Deleting the sidebar node's `onClick` left it green.
Replacing it with the helper's own boolean plus the office name on screen also
removed that file's last hardcoded sleep.

**`not.toContainText(marker)`** where `marker` embeds `Date.now()`. The document
could not contain it. It read as a control and was not one.

### What the gate can and cannot see

`check-assertions-can-fail.mjs` catches the two shapes decidable from the text: a
truthiness check on an object or array literal, and a negated `toContain` of a
value the test itself minted from `Date.now()`. Its controls reproduce the two
REAL defects rather than planted ones.

It says plainly what it cannot see. An assertion that is true for reasons OUTSIDE
the test — the URL that was already `/workspace` — is not decidable from the text
at all. Nothing but a negative control finds that one, which is the argument for
running one on every guard rather than trusting a gate to have caught everything.

124 gates green.

## Round 632 — why the P2P specs cannot recover, and the window that starts it

A targeted hunt into the CI failure — every P2P job red, everything else green.
Its most useful contribution was an ELIMINATION, and it is worth recording because
it is what made the rest tractable.

### What was ruled out, and how

Group notifications take the SAME per-session delivery path on the agent
(`responses/group_event.rs` → `server_connection_map[cid]` →
`send_response_to_tcp_client`) and the SAME CID-routing path in the browser
(`request_id: None` ⇒ `routeByCid`). `test:group` and `test:group-multiuser` pass,
and `group-multiuser` runs multi-tab in ONE browser — the leader/follower forward
path.

So the agent's per-session delivery, `routeByCid`, the orphan buffer and the
cross-tab forward-ack are all exercised and working in the failing run. Every
hypothesis in those layers is refuted as the cause. What remains is the part group
broadcasts do not use: the peer-registration handshake.

### Why ~60 seconds of polling cannot help

The handshake is ONE-SHOT with no recovery at either end. `pending_peer_registrations`
lives on the agent and **no request variant can query it** — there is
`ListAllPeers` and `ListRegisteredPeers` (mutuals only) and nothing for pending
inbound registrations. The invitee's badge derives solely from a store populated
solely by a single `PeerRegisterNotification`.

Every drop point on that one delivery is therefore terminal, and two of them are
silent: if the invitee's session is not yet in `server_connection_map` nothing is
sent and nothing is logged; if the invitee's page has no cid yet the notification
is filtered out on arrival. **This is why the poll count is irrelevant** — the
event is not late, it is gone.

### The window that starts it

`test:p2p` waits for the invitee's workspace before registering and gets past
registration. The four reconnection specs called `createAccount` and slept two
seconds.

And `createAccount` returned TRUE when the workspace never loaded — logging
"WARNING: Workspace may not have fully loaded" and falling through. The comment
forty lines above it describes exactly this defect for the REJECTED case, and says
an unconditional `true` made every caller's
`expect(await createAccount(...)).toBe(true)` an assertion on a constant. The
not-loaded branch kept doing it. The wait it fails is 45 seconds, so this is a
broken workspace rather than a slow one.

Both are fixed: `createAccount` reports the not-loaded case, and the four specs
wait for both pages before registering.

**This is not established as the whole cause.** The agent log lines that would
separate "never sent" from "sent and dropped in the browser" are not in the
artefacts available. What has been removed is one reachable window; the next run's
evidence is better either way, which is the honest claim.

### Left standing, with file:line, for later waves

`respond_register.rs:59-78` answers the invitee "success" for a DISPATCH — the
answer was sent, not that the peer registered — so a harness can log an accept the
inviter never received. `register.rs:112` matches `Ok(_)` on a
`PeerRegisterStatus` that can be `Declined` or `Failed`, treating all three as
success; the SDK added `is_accepted()` precisely because callers did this.
`kernel/mod.rs:509-512` removes every session on a connection after ONE failed
response send, which contradicts the invariant `ext.rs` and CLAUDE.md both state.
And the harness line "P2P registration request sent" is printed after a click with
nothing checked, which is why the logs cannot discriminate — the same "request send
is not response" entry already in this record.

### Selectors, while here

`workspace-init.test.ts` read the init-modal error by `.text-red-400`, a class
absent from the entire app, so that branch never ran and an initialization failure
was reported without the reason that was on screen. The modal now has
`data-testid="init-modal-error"`.

`check-specs-search-for-real-copy` resolves `#id` and `.class` locators as well as
testids. Its first run invented three findings — templated ids
(``id={`${id}-error`}``) and `.ProseMirror`, which TipTap injects and the app
itself queries — so it now reads template fragments and treats a class the app
SELECTS as one the app has. Three of seven findings invented is the ratio that
gets a gate switched off.

124 gates green.

---

## Round 633 — a verdict discarded, and a socket mistaken for a user

Both of the agent defects the P2P hunt left standing are the same mistake: a
value that carries a verdict was read as though *reaching* it were the verdict.

**`register_to_peer()` returns `Ok(PeerRegisterStatus)`, and `Ok` means the
exchange completed.** `peer/register.rs:113` bound the status to
`_peer_register_success` and discarded it, so `Declined` and `Failed { reason }`
both produced `PeerRegisterSuccess`. The requester's UI showed the registration
as done and went on to connect to somebody who had refused — and the refusal
reason, which the peer had supplied, was thrown away one line from where it
would have been shown. A non-accepted status now returns `PeerRegisterFailure`
carrying `refusal_reason()`.

**A failed response send is not a logout.** `kernel/mod.rs:509` ran
`server_connection_map.retain(|_, v| v.associated_localhost_connection != uuid)`
in the error branch of a send to the localhost client — deleting every session
that connection owned. But a failed send is the ORDINARY case of a tab
navigating between a request and its response. A page refresh at the wrong
moment logged the user out of every session in that tab, and any later claim or
reconnect found nothing to claim. The one line in the log said the send failed.
The channel and the media lane still go; they belong to the dead connection. The
session belongs to the user.

### The gate, and the allow-list that was wrong

`check-sessions-are-removed-in-two-places` reads every kernel file for a removal
from `server_connection_map` and requires the file to be one whose job that is,
with a recorded reason. Against the pre-fix tree it went red on exactly
`mod.rs:509` — and flagged three more sites I had not examined.

Three invented findings out of four is the ratio that switches a gate off, and
this session has already done that twice. So I read all three. All three are
legitimate, and all three had been examined in an earlier round — they carry
comments explaining themselves. Two are DisconnectOrphan in
`connection_management.rs`, which IS user-initiated logout: it signs out a
session from the Previous Sessions list rather than the one in front of you, and
the single-session branch checks `may_disconnect` first. The third is
`connection_management_claim.rs`, where ClaimSession finds no SDK session behind
the entry and drops a record of a session that had already ended — the same
class as `connect.rs`.

So the allow-list was incomplete, not the findings invented. It now holds five
files with a reason each.

### The document said two, and meant it

CLAUDE.md stated "Sessions are removed in exactly two places… There is no third
path." Five files remove sessions. The sentence was not loosely worded; it was
the reason the third path in `mod.rs` read as unremarkable to everyone who
walked past it, including me. It now names all five, separates *ending a
session* from *discarding the record of one that ended*, and points at the gate
as the list that has to stay true.

Red on the defect, green on the fix, 125 gates green.

---

## Round 634 — the deploy script had never been run against the deployment

avarok2 is up. Server healthy 38h, UI 24h, real sessions in the log. What is NOT
true is that the scripts in this repo could deploy to it.

Round 630 collapsed two operator scripts into thin wrappers around the
`deploy.sh` that runs ON the host, and wrote a long header about the failure it
was fixing: an operator shown a CLOSED PORT when the configuration was wrong.
The deploy part was right. Two assumptions inside it were not, and neither could
fail in the environment they were written in:

**The directory.** `AVAROK_REMOTE_DIR` defaulted to
`~/development/citadel-workspace-server`. That path exists on the host and is a
stale source checkout — `AUG4_REVIEW.md`, a dev `docker-compose.yml`, and **no
`deploy.sh` in it at all**. The deployment is `/srv/citadel-tenants/avarok`:
compose project `avarok`, holding `deploy.sh`, `docker-compose.production.yml`,
`.env`, the loopback certificate pair and the tenant provisioning scripts. Every
run of the wrapper died on `./deploy.sh: No such file or directory`, which reads
as a broken deploy rather than a script pointed at the wrong place.

**The port.** The post-deploy check was `nc -z 127.0.0.1 12349`. The deployed
server binds `WORKSPACE_BIND_ADDR` from the host's `.env`, which is **12400**.
So the check reported a closed port on a server serving real users, and
`update-avarok-server.sh` exits 1 on that — the identical failure its own header
described as the defect being fixed, removed from one place in the file and left
in another four lines below. Reading the file was not enough.

`check-remote-checks-read-the-deployment` now forbids a literal port in an
`nc -z` probe and requires a script that runs a remote `./deploy.sh` to test for
it first. Both controls red; restore verified by `diff`, not by grep (below).

`restart-remote-server.sh` is deleted. Its one distinct job was uploading a
`kernel.toml` to `$REMOTE_DIR/docker/workspace-server/`, and neither half of that
exists: the deployment directory has no `docker/` tree, and
`docker-compose.production.yml` mounts no kernel config — it is baked into the
image and production is configured through `.env`. Everything else it did was a
second copy of the other script. `docs/PRODUCTION_DEPLOYMENT.md` described both
scripts by their pre-630 behaviour and claimed they deploy "only the workspace
server"; it now states the real path, the real port, and that `deploy.sh`
deploys the stack.

### What the gate cannot see, and what I got wrong proving it

No gate in this repo can know that the DEFAULT path is right. It took an `ls` on
the host. What the gate can do is make the failure name the wrong assumption.

Verifying the negative control, `grep -c 'test -x $REMOTE_DIR/deploy.sh'`
returned 0 for a file that plainly contains that line. BSD grep treats `$` as an
anchor mid-pattern, so the pattern can never match; `-F` matches. It reported
"control APPLIED" for the deletion and "not restored" for the restore, and both
readings were free — the same class of defect as the assertions this record
already collects, one layer up: the control was fine, the proof that it applied
was not. `diff` against the backup settled it. Controls are now verified with
`grep -F` and an occurrence count before and after.

### Three times now

Round 623's `npm ci` broke the sync container. Round 624's `include_str!` broke
the agent image because Docker never copies `scripts/`. Round 630's wrapper
could not find the deploy. Each was correct where it was written and wrong where
it runs, and each passed every gate and local check first. The common thread is
not carelessness about the code; it is that none of the three was ever executed
against the thing it targets.

126 gates green.

---

## Round 635 — verified against the live site, which found two things reading could not

https://work.avarok.net is up, behind Cloudflare, HTTP 200 from outside. The
deployment is `/srv/citadel-tenants/avarok`, the server binds 12400, and 24h of
production logs hold 19 errors — 7 "no route to host", 6 keep-alive timeouts, 6
"queue worker ended" — all inside the `citadel-protocol` dependency and all the
ordinary case of a client that went away. The stack is healthy.

The onboarding dialog IS live there: the deployed bundle carries every line of
its copy, including the promise a member "should not be asked for" the master
password. So the feature shipped. Opening it in a browser is what found what
reading the source could not.

### Three notices for one condition, two of them modal

On the hosted UI the FIRST-RUN state is an unreachable agent — the page comes
from work.avarok.net, the agent runs on the visitor's own machine, and until
they install it `wss://local.avarok.net:12345` refuses. Clicking "Create
Account" there put the intent dialog on screen underneath ConnectionRetryModal,
with OfflineBanner saying the same thing across the top. Two of the three are
modal dialogs, each with its own focus trap.

The retry dialog has to win: it alone carries the agent download links and the
command to run it. The intent dialog now declines to open while the agent is
unreachable, closes if the agent goes away while it is open, and does NOT fall
through to the wizard instead — which would open a registration flow on a
connection that cannot complete.

WorkspaceApp already refuses to stack the retry dialog on OfflineBanner for the
DEVICE-offline case, with this reasoning written beside it. `isOnline` is not
this condition: the agent is on localhost and can be dead while the browser is
perfectly online, which is exactly the hosted case. The same fix, in one of the
two places it belongs — this record's most common entry.

The guard's limit is in the test: `useServiceHealth` starts optimistic and
learns otherwise from a 10s poll, so a click in the first seconds can still open
the dialog. That is why the third test pins that it CLOSES when health arrives
rather than only that it fails to open.

### The buttons now wear their operating system

At the user's request. Detection was already right — Windows gets one button,
Linux one, a Mac both Apple builds (Safari and Chrome both report "MacIntel" on
Apple Silicon, so guessing hands an ARM machine an Intel archive), a phone or
tablet none with a sentence saying why. What was wrong is that all four buttons
drew the same generic download arrow, so in the one case that shows TWO buttons
the icon carried no information at all.

Each platform now draws its own mark — Apple, the four-pane Windows logo, and
Tux — as inline SVG, because lucide-react carries no brand marks and a remote
sprite would be a network request on a screen shown BECAUSE the network failed.
The test asserts three distinct rendered path strings rather than distinct
component identities, since two components drawing the same glyph would pass the
latter, and that is precisely the state being replaced.

`check-components-are-mounted` then failed: exported individually, the three
glyphs were components no JSX site renders. It was right — they are reached
through the `OS_ICONS` record — and the fix was to stop exporting them rather
than to take the exemption it offered, so the record is the only door.

### A false failure worth naming

Three UI test files fail in a standalone worktree because they read PARENT-repo
files (`release-agent.yml`, a Rust constant, the client library). Verified as
pre-existing by stashing every change and getting the identical 5 failures. They
pass in CI, where the parent is checked out. Each opens with an existence
assertion, so they fail loudly instead of passing vacuously over a missing file
— which is why they are noise here rather than a hole.

126 gates green.

---

## Round 636 — the hourly sweep, and a gate that read green over a security hole

Four read-only inspection agents (developer experience, robustness, performance,
test quality). Fable's quota was exhausted and all four died on a 429 before
doing anything; relaunched on opus, which is why the fallback in the standing
instruction exists.

### The one that mattered: 16 security tests compiled nowhere

`origin_policy` and the `websockets` io_interface are both behind
`#[cfg(feature = "websockets")]`, and that feature is a default nowhere. Measured:
`cargo test -p citadel-internal-service-connector --lib` compiles **11** tests;
with `--features websockets` it compiles **27**.

The 16 missing ones are the entire suite for the agent's loopback boundary —
which browser origins may open a control connection to it — including
`a_listed_origin_completes_the_handshake` and
`an_unlisted_origin_is_refused_at_the_handshake`. They were not skipped and not
reported as skipped. They were absent from the binary, so replacing the origin
check with "accept every origin" would have turned nothing red, while any web
page the user visited could drive their agent.

Production ships the feature. CI was green over a configuration nobody runs
while the one everybody runs went untested.

**This is the second occurrence.** Round 564 records the same defect and the same
fix, "6 passed" becoming "33 passed". The flag was lost again in the interim,
silently — because a test count going DOWN looks exactly like a green run.

`check-feature-gated-tests-are-compiled` now fails if it goes missing again.
Its own first version reported two ILM modules as uncompiled while
`cargo nextest list` showed their six tests running: the connector depends on ILM
with `features = ["testing"]`, which turns the feature on for the whole build.
Two invented findings out of two new ones is the ratio that gets a gate switched
off, so it resolves three sources — a CI flag, a manifest dependency's feature
list, and the crate's own `default`. Control: deleting the flag from both
workflows turns it red naming both security modules.

### Work whose only reader is a log line

`log::info!` checks the level. A `let` above it does not. Three bindings in the
connector's messenger were built unconditionally and read only by log macros: an
FNV-1a fingerprint over the WHOLE payload (three operations per byte — 1,048,576
iterations per delivery for a 1 MiB update), the entire routing DashMap
collected per routed message, and the same collect per ILM registration. The
routing collect was also read by a `warn!` on a rare branch, so one binding
served both and the rare branch's cost became the common branch's.

The UI already knew this and has a gate for it. The fix never crossed the
language boundary.

`check-log-arguments-are-cheap-in-rust` now enforces it, and took **three**
attempts to stop reporting green over the defect it was written for:

1. It walked back to the nearest `{` to find the enclosing statement. Every Rust
   format string is full of `{}` placeholders.
2. Masking string literals fixed that, and it still missed the site, because the
   macro's arguments contained a real `match … { … }`. Braces inside arguments
   are not a statement boundary either. Fixed by computing actual paren-matched
   macro spans.
3. It still missed the COSTLIEST site, the byte loop, because the accumulator
   branch was written `ACCUMULATOR.exec(line) ? null : null` — `null` either way.
   A branch that cannot contribute, in the gate meant to catch exactly that.

Each was found only by running it against the tree that still had the defect. A
gate is not finished when it passes; it is finished when it has failed on the
thing it is for.

### A denylist is only as complete as its last edit

`check-debug-args-are-cheap` did not name `formatForDebug`, which `JSON.parse`s
its argument and rebuilds the whole object recursively. It sat unguarded inside a
`debugLog` on the session-store write path, so every auth, auto-reconnect,
logout, role update and active-index change re-parsed and rebuilt the entire
stored-session list in production and discarded it.

The control is the useful part: with the site unguarded AND the old denylist
restored, the gate passes. That is the hole demonstrated rather than inferred.

### The fix from round 635, applied to one of two buttons

The robustness sweep found that round 635 guarded "Create Account" against an
unreachable agent and left "Sign In" — the button immediately beside it —
untouched. The reasoning written there is about the SCREEN, not registration.

So: the most common defect class in this record, committed by the fix for
another instance of it, one hour later, by me.

Unguarded, a visitor with no agent clicks Sign In, gets the sign-in card
(`fixed inset-0 z-50`, its own focus trap), then ConnectionRetryModal on top,
OfflineBanner above, and after typing credentials "Connection timeout, check
your network" — naming neither the agent nor the fix.

`useAgentGatedStep` now owns both halves, refuse-to-open and retreat-once-open,
in one hook. Landing crossed its length ceiling when the guard was inlined, and
the ceiling was right: extraction was the fix, not a raised limit. Each half is
independently controlled.

### Still open, from the sweeps

Recorded rather than acted on: the UI README is the untouched Lovable scaffold
(`npm run dev` is `tilt trigger ui`, and `npm i` creates dangling symlinks and
exits 0); preflight runs 112 derived gates BEFORE `submodules are populated`, so
a clone without `--recurse-submodules` gets 80 failures over 1279 lines and the
line naming the cause at 1154; `check-assertions-can-fail` matches zero sites and
misses the two real defects quoted in its own header; every assertion-quality
gate points only at `integration-tests/src`, leaving 4,338 unit assertions
ungated; `hosted-ui-loopback.spec.ts` has never run because the script its skip
message names does not exist; `test-session-management.sh` greps for log lines
deleted months ago and can only print INCONCLUSIVE; the reconnect path still
reads the lenient session query destructively; and opening a chat channel reads a
room's entire history to return 50 messages.

128 gates green.
