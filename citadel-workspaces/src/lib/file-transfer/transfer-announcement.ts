/**
 * Building the in-band message that tells the recipient a transfer exists.
 *
 * A transfer has two halves. The bytes go over the protocol's own file transfer
 * (SendFile), which raises a FileTransferRequestNotification on the recipient's
 * internal service. The BUBBLE in the conversation comes from somewhere else
 * entirely: an ordinary P2P message carrying a FileTransferRequest messaging
 * layer, which the recipient's FileTransferMessageHandler turns into a
 * `message_type: 'file_transfer'` entry in the conversation.
 *
 * Only the first half was ever sent. `createFileTransferRequest` — the builder
 * for the second — had no caller, so recipients got bytes and no bubble, and in
 * async mode no indication at all: the code there notes the recipient "discovers
 * the transfer via the message-protocol path", which is precisely the message
 * that was never sent.
 *
 * Kept separate from io.ts so the decision of what to announce can be tested
 * without a socket.
 */

import { createFileTransferRequest, type MessagingLayer } from '@/types/messaging-layer';
import type { P2PMessagingLayerPayload } from '@/types/p2p-commands';
import type { FileTransfer } from './types';

/**
 * Wrap a messaging layer in the P2P envelope used for file-transfer signals.
 *
 * `message_id` is distinct from any transfer id on purpose: it identifies the
 * chat MESSAGE, and reusing a transfer id would collide with any later message
 * about the same transfer in the conversation's message map.
 */
export function buildLayerPayload(
  layer: MessagingLayer,
  senderCid: bigint,
  recipientCid: bigint
): P2PMessagingLayerPayload {
  return {
    layer,
    sender_cid: senderCid,
    recipient_cid: recipientCid,
    message_id: crypto.randomUUID(),
    index: 0,
    message_type: 'file_transfer',
  };
}

/**
 * The in-band announcement for `transfer`.
 *
 * `transfer_id` is carried through deliberately: the recipient's accept/decline
 * has to name the same transfer the bytes arrive under, so a fresh id here would
 * produce a bubble that can never be matched to its transfer.
 */
export function buildTransferAnnouncement(transfer: FileTransfer): P2PMessagingLayerPayload {
  const layer: MessagingLayer = createFileTransferRequest(
    transfer.fileName,
    transfer.fileSize,
    transfer.fileType,
    {
      transfer_id: transfer.id,
      thumbnail: transfer.thumbnail,
      expiry_timestamp: transfer.expiresAt,
    },
  );

  const payload: P2PMessagingLayerPayload = buildLayerPayload(layer, BigInt(transfer.senderCid), BigInt(transfer.recipientCid));
  // Announced again after a reload (reload-recovery.ts), the offer keeps its
  // message id, so the recipient's conversation files it once, not twice.
  return transfer.offerMessageId === undefined ? payload : { ...payload, message_id: transfer.offerMessageId };
}
