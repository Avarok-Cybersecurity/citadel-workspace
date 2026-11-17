/**
 * Telling two tabs apart when the browser has given them the same identity.
 *
 * The instance id lives in `sessionStorage` so it survives a reload. Its comment
 * claimed it "survives page reloads but not new tabs" — but Chrome and Safari
 * COPY sessionStorage into the new context on **Duplicate Tab**, and into any
 * context the page opens. The duplicate therefore boots with a byte-identical
 * instance id, and the channel's self-traffic filter then makes the twins
 * completely invisible to each other:
 *
 *   if (message.senderInstanceId === instanceManager.instanceId) return;
 *
 * Neither sees the other's heartbeat or election claim, so both take the "no
 * heartbeat ever received" branch and both become leader — permanently. Two live
 * WebSockets from one browser, each ClaimSession-ing every session away from the
 * other, and every directed message processed twice.
 *
 * There is no storage that survives a reload but not a duplication, so identity
 * cannot be made collision-proof by choosing a different store. It has to be
 * detected and repaired at runtime, which needs one thing the instance id cannot
 * provide: a marker that is unique per DOCUMENT.
 */

/**
 * Unique to this document. Generated at module load and never persisted, so a
 * duplicated tab gets a different one even though its instance id is copied.
 *
 * Used ONLY for self-filtering and conflict detection — never for election,
 * which must stay deterministic on the instance id.
 */
export const documentNonce: string = `${Date.now().toString(36)}-${Math.random()
  .toString(36)
  .slice(2, 10)}`;

/**
 * A fresh instance id: timestamp(ms) * 10^6 + random.
 *
 * Timestamp-ordered so later tabs sort higher, which is what makes
 * highest-id-wins election deterministic.
 */
export function mintInstanceId(): string {
  const timestamp: bigint = BigInt(Date.now());
  const random: bigint = BigInt(Math.floor(Math.random() * 1_000_000));
  return (timestamp * 1_000_000n + random).toString();
}

/**
 * Whether an inbound message came from this very document.
 *
 * Messages predating this field have no nonce; fall back to the instance id so
 * a mixed-version browser still filters its own traffic rather than looping.
 */
export function isFromThisDocument(
  senderInstanceId: string,
  senderDocumentNonce: string | undefined,
  myInstanceId: string
): boolean {
  if (senderDocumentNonce !== undefined) return senderDocumentNonce === documentNonce;
  return senderInstanceId === myInstanceId;
}

/**
 * Whether THIS document should re-roll its instance id.
 *
 * True when another document is using our id. Only one of the pair may re-roll,
 * or both churn: the lower nonce yields, which both sides compute identically
 * from the same two values.
 */
export function shouldReissueIdentity(
  senderInstanceId: string,
  senderDocumentNonce: string | undefined,
  myInstanceId: string
): boolean {
  if (senderDocumentNonce === undefined) return false;
  if (senderDocumentNonce === documentNonce) return false;
  if (senderInstanceId !== myInstanceId) return false;
  return documentNonce < senderDocumentNonce;
}

/** What a receiving document should do with an inbound channel message. */
export type InboundDisposition = 'ignore-own' | 'reissue-identity' | 'process';

/**
 * Classify an inbound message before any routing happens.
 *
 * Keeps the twin-detection rules in one place: the channel asks what to do
 * rather than re-deriving the comparison, so the two branches cannot drift.
 */
export function classifyInbound(
  message: { senderInstanceId: string; senderDocumentNonce?: string },
  myInstanceId: string
): InboundDisposition {
  const { senderInstanceId, senderDocumentNonce } = message;
  if (isFromThisDocument(senderInstanceId, senderDocumentNonce, myInstanceId)) return 'ignore-own';
  if (shouldReissueIdentity(senderInstanceId, senderDocumentNonce, myInstanceId)) {
    return 'reissue-identity';
  }
  return 'process';
}

/**
 * Whether the channel should go on to route `message`.
 *
 * Returns false for our own traffic and for a twin collision, performing the
 * re-roll in the latter case. Lives here rather than in the channel so the
 * detection rules and the repair stay in one file.
 */
export function acceptInbound(
  message: { senderInstanceId: string; senderDocumentNonce?: string },
  myInstanceId: string,
  repair: { reissue: () => void; announce: () => void }
): boolean {
  const disposition: InboundDisposition = classifyInbound(message, myInstanceId);
  if (disposition === 'reissue-identity') {
    // Take a new id and tell everyone, so the twin pair converges immediately
    // rather than at the next heartbeat.
    repair.reissue();
    repair.announce();
  }
  return disposition === 'process';
}
