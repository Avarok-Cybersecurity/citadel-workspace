
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
