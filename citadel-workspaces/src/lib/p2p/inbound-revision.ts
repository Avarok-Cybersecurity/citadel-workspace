/**
 * Applying a peer's edit or delete to our transcript.
 *
 * The inbound mirror of `messenger-revision.ts`, which is the outbound half.
 * Extracted when `message-handler-routing.ts` crossed the 250-line limit; the
 * two branches belong together because they answer the same question in the
 * same way, and the answer is not obvious.
 *
 * The peer's revision is AUTHORITATIVE. When the store cannot take it, memory
 * is still revised and the event still emitted -- refusing to emit would leave
 * the screen disagreeing with memory, which is worse than either alternative.
 *
 * Revised on the STORED page first (record-revision). After a reload the
 * in-memory conversation is empty and the window only ever holds the latest
 * 100, so a revision that looked only there was dropped as "unknown-message"
 * and the receiver kept the old text, or the retracted message, for good.
 *
 * What must not happen is silence. Both writes return a boolean, and both were
 * discarded: a storage failure removed a message from the screen while leaving
 * it in the stored page, so it returned on reload, disagreeing with a peer who
 * had retracted it -- and the only trace was a `debugLog`, compiled out of the
 * build the user is running. `errorLog` emits in production, which is the point.
 */
import { eventEmitter } from '../event-emitter';
import { debugLog, errorLog } from '@/lib/debug-config';
import { recordRevision, type RecordedRevision } from './record-revision';
import type { MessageHandlerConfig } from './message-handler-types';

/** Apply a peer's edit. */
export async function applyIncomingEdit(
  config: MessageHandlerConfig,
  peerCid: bigint,
  messageId: string,
  contents: string,
  editedAt: number,
): Promise<void> {
  const outcome: RecordedRevision = await recordRevision(
    config.getOrCreateConversation(peerCid), peerCid, messageId, peerCid, { kind: 'edit', contents, editedAt },
  );
  if (!outcome.applied) {
    // Do not swallow this. An edit for a message we do not have, or one the
    // peer did not send, means our view and theirs have diverged.
    debugLog('P2PMessageHandler', `Ignored edit of ${messageId}: ${outcome.reason}`);
    return;
  }
  if (!outcome.persisted) {
    errorLog('P2PMessageHandler',
      `Edit of ${messageId} from ${peerCid} was not written to the stored transcript; ` +
      'a reload will show the pre-edit text, which the peer no longer has.');
  }
  eventEmitter.emit('p2p:message-updated', outcome.message);
}

/** Apply a peer's delete. */
export async function applyIncomingDelete(
  config: MessageHandlerConfig,
  peerCid: bigint,
  messageId: string,
): Promise<void> {
  const outcome: RecordedRevision = await recordRevision(
    config.getOrCreateConversation(peerCid), peerCid, messageId, peerCid, { kind: 'delete' },
  );
  if (!outcome.applied) {
    debugLog('P2PMessageHandler', `Ignored delete of ${messageId}: ${outcome.reason}`);
    return;
  }
  if (!outcome.persisted) {
    errorLog('P2PMessageHandler',
      `Delete of ${messageId} from ${peerCid} was not applied to the stored transcript; ` +
      'the retracted message will return on reload.');
  }
  eventEmitter.emit('p2p:message-deleted', { peerCid, messageId });
}
