
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
