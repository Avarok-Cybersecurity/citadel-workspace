/**
 * Executed Request Registry
 *
 * Request ids that a DIFFERENT tab's leader has already begun executing.
 *
 * During a leadership flap two tabs hold `isLeader` at once: a backgrounded
 * leader's heartbeat timer is throttled to roughly once a minute against the
 * five-second dead-leader timeout, so a foreground follower claims leadership
 * (`tryBecomeLeader`) while the sticky leader keeps it (`handleLeaderElection`
 * rule 1) until its rejection heartbeat lands. In that window the outbound
 * queue's leader-change replay re-delivers every un-acked entry to the
 * transient leader — entries the sticky leader may be executing RIGHT NOW,
 * un-acked only because the proxy handlers ack after the work completes. The
 * leader-side `inFlight` set is per-tab and cannot see across leaders, so a
 * workspace write or a `Connect` executed twice.
 *
 * This registry is the cross-leader analog of `inFlight`: the executing leader
 * broadcasts a `request-executed` claim the moment it starts the work
 * (leader-outbound-handler), every tab records the claims it RECEIVES here
 * (channel-message-dispatch), and a leader consults the registry before
 * executing. BroadcastChannel never delivers to the posting context, so a tab
 * only ever records OTHER tabs' claims — its own completed ids stay
 * re-runnable, which the in-flight guard's contract requires.
 */
import { TIMEOUT } from '../timeout-constants';

/**
 * How long a claim is remembered.
 *
 * After OUTBOUND_ACK_MS the requester's outer deadline (send-to-leader.ts) has
 * force-acknowledged the id out of the queue, so no retry or replay of it can
 * ever fire again — remembering it longer buys nothing, and would only delay
 * the legitimate recovery retry when a leader genuinely dies mid-execution.
 */
const CLAIM_TTL_MS: number = TIMEOUT.OUTBOUND_ACK_MS;

/**
 * Hard cap so a claim flood cannot grow the map faster than the TTL drains it.
 * 1000 uuid-sized entries is under 100KB; a browser tab issues outbound
 * requests at user-action rate, so reaching the cap inside one TTL window
 * would itself be a defect elsewhere.
 */
const MAX_CLAIMS: number = 1000;

/**
 * requestId -> when the claim was recorded. Insertion order is time order
 * because an already-present id is never re-stamped, so pruning can stop at
 * the first live entry.
 */
const claims: Map<string, number> = new Map();

function prune(now: number): void {
  for (const [id, recordedAt] of claims) {
    if (now - recordedAt <= CLAIM_TTL_MS) break;
    claims.delete(id);
  }
  while (claims.size > MAX_CLAIMS) {
    const oldest: string | undefined = claims.keys().next().value;
    if (oldest === undefined) break;
    claims.delete(oldest);
  }
}

/** Record a claim received from another tab's leader. */
export function recordRemoteExecution(requestId: string): void {
  const now: number = Date.now();
  prune(now);
  if (!claims.has(requestId)) {
    claims.set(requestId, now);
  }
}

/** Has another leader already begun executing this request? */
export function wasExecutedByAnotherLeader(requestId: string): boolean {
  prune(Date.now());
  return claims.has(requestId);
}

/** Reset between tests; nothing in production has a reason to forget claims. */
export function clearExecutionClaims(): void {
  claims.clear();
}
