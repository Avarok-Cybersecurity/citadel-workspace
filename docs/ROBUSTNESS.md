
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
