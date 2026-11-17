/**
 * Put the sender's own file offer into the sender's own conversation.
 *
 * The announcement that gives the RECIPIENT a bubble went out, and nothing put
 * one on the sending side: the thread showed no trace of the file, so the
 * sender had nothing to watch progress on, cancel, or confirm had gone. A text
 * message is added to its own thread by `MessageSender`; this is that step for
 * the one message type that is not sent through it.
 */

import { isFileTransferRequest } from '@/types/messaging-layer';
import type { P2PMessagingLayerPayload } from '@/types/p2p-types';
import type { P2PMessage } from './p2p-types';
import { fileTransferMessage } from './file-transfer-message';
import { FILE_TRANSFER_EVENTS, type OfferAnnounced } from '../file-transfer/events';
import { toStoredState } from '../file-transfer/stored-state';
import { debugLog } from '@/lib/debug-config';

export interface RecordOutgoingFileTransferDeps {
  addMessageToConversation: (peerCid: bigint, message: P2PMessage) => Promise<boolean>;
  notifyMessageListeners: (message: P2PMessage) => void;
  emitEvent: (event: string, data: unknown) => void;
}

export async function recordOutgoingFileTransfer(
  deps: RecordOutgoingFileTransferDeps,
  payload: P2PMessagingLayerPayload,
  transferState: NonNullable<P2PMessage['transfer_state']>,
): Promise<void> {
  if (!isFileTransferRequest(payload.layer)) {
    throw new Error(`recordOutgoingFileTransfer: payload ${payload.message_id} is not a file-transfer offer`);
  }
  const peerCid: bigint = BigInt(payload.recipient_cid);
  const message: P2PMessage = fileTransferMessage(
    payload,
    payload.layer,
    BigInt(payload.sender_cid),
    'sent',
    transferState,
  );
  if (!(await deps.addMessageToConversation(peerCid, message))) {
    return;
  }
  deps.notifyMessageListeners(message);
  deps.emitEvent('p2p:message-sent', { peerCid, message });
}

/**
 * Record every offer this client announces. Named `bind…` so
 * `check-installers-are-called` covers it.
 *
 * On the event bus rather than called from `announceTransfer`, so the file
 * transfer module does not reach into conversation storage -- and its tests,
 * which stub only the wire, do not start doing storage I/O.
 */
export function bindOutgoingFileOffers(
  listen: (event: string, handler: (data: OfferAnnounced) => void) => void,
  deps: RecordOutgoingFileTransferDeps,
): void {
  listen(FILE_TRANSFER_EVENTS.OFFER_ANNOUNCED, ({ announcement, transferState }: OfferAnnounced): void => {
    recordOutgoingFileTransfer(deps, announcement, toStoredState(transferState)).catch((error: unknown): void => {
      debugLog('RecordOutgoingFileTransfer', `Could not record the sent offer ${announcement.message_id}:`, error);
    });
  });
}
