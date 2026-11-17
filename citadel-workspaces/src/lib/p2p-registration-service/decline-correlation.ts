/**
 * Which `PeerRegisterRespond` request ids carried `accept: false`.
 *
 * The internal service answers a decline with `PeerRegisterSuccess` — the
 * decline WAS delivered successfully, so from its side the name is accurate.
 * The frontend then read that as "registration succeeded" and ran the full
 * registration path: `isRegistered = true`, into `registeredPeers`, a
 * `p2p:peer-registered` event, and a broadcast to the other tabs. Declining
 * somebody added them.
 *
 * Nothing on the wire distinguishes the two outcomes — one response type means
 * both — so the only party that can tell them apart is the one that chose. This
 * remembers that choice against the request id it was sent with.
 *
 * Bounded: ids are unbounded and a decline whose response never arrives would
 * otherwise be remembered forever.
 */
const MAX_REMEMBERED: number = 100;

const declineRequestIds: Set<string> = new Set<string>();

/** Record that this request id was a decline, not an acceptance. */
export function markAsDecline(requestId: string): void {
  declineRequestIds.add(requestId);
  if (declineRequestIds.size > MAX_REMEMBERED) {
    const oldest: string | undefined = declineRequestIds.values().next().value;
    if (oldest !== undefined) declineRequestIds.delete(oldest);
  }
}

/**
 * True if this response answers a decline. Consumes the record: one response
 * per request, and holding it after that is just a leak.
 */
export function consumeWasDecline(requestId: string): boolean {
  return declineRequestIds.delete(requestId);
}

/** Test seam: the set outlives a module import. */
export function forgetDeclines(): void {
  declineRequestIds.clear();
}
