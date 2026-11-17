/**
 * What the discovery modal does with a `PeerRegisterFailure`.
 *
 * Two outcomes, and they are opposites. "Already registered" is a SUCCESS
 * wearing the Failure variant — see
 * `lib/peer-registration-store/already-registered.ts` — so the row is marked
 * registered and nothing is said. Anything else is a genuine refusal and is
 * reported by name.
 *
 * A refusal used to reach only `debugLog`, compiled out in production, so the
 * user was told "Request Sent" and then nothing. It is correlated by
 * `request_id`, because `PeerRegisterFailure` carries no `peer_cid`.
 *
 * WHICH PEER IS NOT IN THE RESPONSE, AND MUST NOT BE READ FROM IT. The variant
 * carries `cid`, and that is the LOCAL SESSION's id -- the peer appears only
 * inside the message text. This branch read `failure.cid` and put it in a Set
 * keyed by PEER cid, so the user's own id was marked registered and the peer's
 * row stayed unmarked. Since CIDs are permanent, every reconnect re-registers,
 * gets "already registered" back, and lands here: the row never marks, the
 * branch says nothing by design, and pressing Connect again is a silent no-op
 * for as long as the user keeps trying. The sibling `PeerRegisterSuccess`
 * branch reads `peer_cid` and is correct.
 *
 * So the outcome no longer carries a cid at all. The caller correlated the
 * request and knows the peer; it passes it in. A value that cannot be right
 * should not be available to read.
 *
 * Extracted because `usePeerDiscovery` crossed the 250-line limit, and because
 * the decision is worth reading on its own: telling the user "your request was
 * not accepted" about a peer who IS registered is the opposite of what happened,
 * and leaves the row unmarked so they try again.
 */
import { isAlreadyRegistered } from '@/lib/peer-registration-store/already-registered';

/**
 * Who a sent registration was for. Held by the CALLER, keyed by request id,
 * because the response carries neither the peer's cid nor its name. `cid` stays
 * bigint per CLAUDE.md; it is stringified only at the display boundary.
 */
export interface SentRequest {
  readonly cid: bigint;
  readonly username: string;
  /** The store recorded it, so `PeerRefusalNotice` announces a refusal; undefined until the send returns. */
  recorded?: boolean;
}

/** The peer a failure is about, or undefined when the request is not ours. */
export function correlateFailure(
  failure: Record<string, unknown>,
  sent: Map<string, SentRequest>,
): { requestId: string; peer: SentRequest } | undefined {
  const requestId: string | undefined = failure.request_id as string | undefined;
  if (!requestId) return undefined;
  const peer: SentRequest | undefined = sent.get(requestId);
  return peer ? { requestId, peer } : undefined;
}

export type PeerRegisterFailureOutcome =
  | { kind: 'already-registered' }
  | { kind: 'refused'; reason: string | undefined };

/** Classify the failure. Pure, so the rule is testable without a modal. */
export function classifyPeerRegisterFailure(
  failure: Record<string, unknown>,
): PeerRegisterFailureOutcome {
  const reason: string | undefined =
    typeof failure.message === 'string' ? failure.message : undefined;
  if (isAlreadyRegistered(reason)) {
    // Deliberately no cid: see the header. `failure.cid` is this session's.
    return { kind: 'already-registered' };
  }
  return { kind: 'refused', reason };
}

/** What the modal needs in order to act on the outcome. */
export interface PeerRegisterFailureDeps {
  /** Takes no cid: the caller knows the peer, the response does not. */
  readonly markRegistered: () => void;
  readonly reportRefusal: (reason: string | undefined) => void;
}

/**
 * Apply the outcome. Kept beside the classification so the two cannot drift:
 * the whole defect was one branch treating a success as a refusal.
 */
export function applyPeerRegisterFailure(
  failure: Record<string, unknown>,
  deps: PeerRegisterFailureDeps,
): void {
  const outcome: PeerRegisterFailureOutcome = classifyPeerRegisterFailure(failure);
  if (outcome.kind === 'already-registered') {
    deps.markRegistered();
    return;
  }
  deps.reportRefusal(outcome.reason);
}

/** Notes on the sent entry whether the store recorded it (see `SentRequest.recorded`). */
export function noteRecorded(sent: Map<string, SentRequest>, requestId: string, recorded: boolean): void {
  const entry: SentRequest | undefined = sent.get(requestId);
  if (entry) entry.recorded = recorded;
}

/**
 * What the discovery view says about a refusal, or null when it says nothing:
 * a recorded request's refusal is `PeerRefusalNotice`'s to announce, with the
 * reason when the peer published one, and saying it here too put two toasts on
 * screen for one decline. Unknown (the answer beat the send's return) counts as
 * recorded, since the store writes before the request goes out.
 */
export function discoveryRefusalCopy(peer: SentRequest, reason: string | undefined): string | null {
  if (peer.recorded !== false) return null;
  return reason
    ? `Your request to ${peer.username} was not accepted: ${reason}`
    : `Your request to ${peer.username} could not be delivered.`;
}
