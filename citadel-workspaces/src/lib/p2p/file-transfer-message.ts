/**
 * The conversation entry for a file-transfer offer, on either side of it.
 *
 * One builder for both ends. The recipient's entry was built inside the inbound
 * handler and the sender's was never built at all, so the person who sent a
 * file saw nothing in their own thread -- no bubble to watch, cancel or open.
 * Both entries describe the same offer and are keyed by the same message id
 * (which is what lets the recipient's receipts reach the sender's bubble), so
 * they come from the same place.
 */

import type { FileTransferRequestData, MessagingLayerType } from '@/types/messaging-layer';
import type { P2PMessagingLayerPayload } from '@/types/p2p-types';
import type { P2PMessage } from './p2p-types';

export type FileTransferRequestLayer = { type: MessagingLayerType.FileTransferRequest } & FileTransferRequestData;

export function fileTransferMessage(
  payload: P2PMessagingLayerPayload,
  layer: FileTransferRequestLayer,
  senderCid: bigint,
  status: P2PMessage['status'],
  transferState: NonNullable<P2PMessage['transfer_state']>,
): P2PMessage {
  return {
    id: payload.message_id,
    content: `File transfer: ${layer.file_name}`,
    senderCid,
    recipientCid: BigInt(payload.recipient_cid),
    timestamp: layer.timestamp,
    index: payload.index,
    status,
    message_type: 'file_transfer',
    transfer_id: layer.transfer_id,
    file_name: layer.file_name,
    file_size: layer.file_size,
    file_type: layer.file_type,
    file_thumbnail: layer.thumbnail,
    transfer_state: transferState,
  };
}
