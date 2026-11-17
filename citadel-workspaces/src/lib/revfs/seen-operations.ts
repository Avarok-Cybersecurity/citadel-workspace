/**
 * An operation is applied once, however many times it arrives.
 *
 * CI evidence, run 33304689050: Bob sent SEVEN `SyncRequest`s and Alice's
 * handler ran for ONE HUNDRED of them. Bob applied the same `Mkdir` twice,
 * 21ms apart, with one `op_id`. The reliable transport redelivers, and nothing
 * on this side noticed.
 *
 * The cost is not the duplicate work. Every redelivered `SyncRequest` makes the
 * receiver answer with a fresh 564-byte `SyncResponse` on the same reliable
 * channel, so seven requests became a hundred replies — and the `PlaceFile` and
 * `Rmdir` the user actually asked for queued behind that flood and never
 * arrived. `Peer Sees File: FAIL` and a folder that stayed on the peer's screen
 * are both downstream of it.
 *
 * Bounded, because op ids are unbounded. A few hundred is far more than a
 * redelivery window and small enough to be free.
 *
 * The mechanism itself is generic and lives in `lib/seen-ids`; group messages
 * need the same thing for the same reason. What stays here is the evidence and
 * the key convention.
 */
import { isNewId, forgetId, forgetSeenIds } from '@/lib/seen-ids';

/**
 * True the FIRST time this key sees this op id, false afterwards.
 *
 * Keyed per peer pair: two peers can mint ids independently, and a collision
 * across pairs would silently drop somebody's operation.
 */
export function isNewOperation(key: string, opId: string): boolean {
  return isNewId(`revfs:${key}`, opId);
}

/** Test seam: the map outlives a module import. */
export function forgetSeenOperations(): void {
  forgetSeenIds();
}

/**
 * Forget an operation whose application failed, so a retry is a real attempt.
 *
 * The seen-mark is taken before the work, so a failure between the two leaves an
 * op recorded as handled that never landed -- and the sender's retry then gets a
 * success Ack for it.
 */
export function forgetOperation(key: string, opId: string): void {
  forgetId(`revfs:${key}`, opId);
}
