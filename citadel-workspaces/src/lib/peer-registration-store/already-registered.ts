/**
 * "Peer already registered" is a success wearing a Failure variant.
 *
 * CIDs are permanent (CLAUDE.md, "CID Lifecycle"): registrations are stored by
 * CID pair and the CID never changes, so after any disconnect and reconnect the
 * registration is still on the server and the agent answers the next attempt
 * with `PeerRegisterFailure { message: "Peer N is already registered" }`.
 * CLAUDE.md states the consequence outright — *"'Peer Already Registered' is
 * NOT an Error … Treat this as success, not failure."*
 *
 * Four modules read that variant and three knew the rule. The fourth,
 * `accept-matcher.ts`, rejected its promise — and `lifecycle.ts` awaits that
 * promise on the line before `connectToPeer`, so the rejection skipped the
 * connect and no P2P channel was opened at all. The agent log for the six
 * failing specs shows exactly that: every send `to SERVER (no peer_cid)`, and
 * not one `[PeerChannelCreated]`.
 *
 * One predicate, because the test for it was spelled three different ways
 * across the modules that had it, and a fourth spelling is how the next one
 * drifts.
 */

/**
 * Messages that CONTAIN the phrase while meaning the opposite.
 *
 * The agent answers a failed peer-list read with
 *
 *   "Could not determine whether {peer} is already registered: {err}.
 *    Nothing was changed; try again."
 *
 * -- correctly refusing to guess. But it contains "is already registered", so
 * the substring test below said SUCCESS, and five consumers acted on it: the
 * accept-matcher resolved and `lifecycle.ts` went on to connect to an
 * unregistered peer, `event-handlers.ts` deleted the outgoing retry record,
 * the discovery modal marked the row, and `p2p-registration-service` emitted
 * `p2p:peer-registered`, which auto-connect turned into `addOnlinePeer`. The
 * connect then failed into a `debugLog` compiled out of production. Net: a peer
 * shown online and registered, the retry record destroyed, no registration, and
 * nothing said.
 *
 * An explicit exclusion rather than a tighter positive pattern, because the
 * agent's success wording and the UI's own strings are both loose and a strict
 * anchor would silently start rejecting the case this exists to accept. What
 * makes that safe is not this list but the gate:
 * `check-already-registered-predicate-matches-the-agent.mjs` runs EVERY
 * `PeerRegisterFailure` message the Rust can send through this function and
 * asserts exactly one is classified as success. A sixth ambiguous message fails
 * there rather than here.
 */
const MEANS_THE_OPPOSITE: readonly RegExp[] = [/could not determine/i];

/** Whether an agent refusal message is really the already-registered case. */
export function isAlreadyRegistered(message: string | undefined): boolean {
  if (message === undefined) return false;
  if (MEANS_THE_OPPOSITE.some((re) => re.test(message))) return false;
  // Case-insensitive: the agent writes "is already registered" and the UI has
  // carried "Already registered" in its own strings.
  return /already registered/i.test(message);
}
