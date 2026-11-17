/**
 * The message-plane halves of a transfer: the recipient's handling of an
 * offer, and the sender's handling of the recipient's accept/decline.
 * Both modes move their bytes over the protocol (see transfer-lifecycle).
 */

import { eventEmitter } from '../event-emitter';
import { debugLog } from '@/lib/debug-config';
import {
  MessagingLayerType,
  type FileTransferRequestData,
  type FileTransferResponseData,
} from '@/types/messaging-layer';
import { FILE_TRANSFER_EVENTS } from './events';
import type { FileTransferState } from './state';
import type { FileTransferIO } from './io';
import type { FileTransfer } from './types';
import { isTerminalTransferState } from './transfer-outcome';

/** Dependencies injected from the FileTransferService */
export interface AsyncTransferDeps {
  state: FileTransferState;
  io: FileTransferIO;
  emitStateChange: (transfer: FileTransfer) => void;
  saveTransfer: (transfer: FileTransfer) => Promise<void>;
}

/**
 * Handle incoming FileTransferRequest - create transfer record, auto-accept if enabled.
 */
export async function handleTransferRequest(
  deps: AsyncTransferDeps,
  data: FileTransferRequestData & { type: MessagingLayerType.FileTransferRequest },
  senderCid: string,
  getAutoAccept: (cid: string) => boolean,
  acceptTransfer: (id: string) => Promise<void>
): Promise<void> {
  const currentCid: bigint | null = await deps.io.getCurrentCid();
  if (!currentCid) return;

  const transfer: FileTransfer = {
    id: data.transfer_id,
    fileName: data.file_name,
    fileSize: data.file_size,
    fileType: data.file_type,
    thumbnail: data.thumbnail,
    state: 'pending',
    progress: 0,
    senderCid,
    recipientCid: currentCid.toString(),
    createdAt: data.timestamp,
    updatedAt: Date.now(),
    expiresAt: data.expiry_timestamp,
    isIncoming: true,
  };

  deps.state.setTransfer(transfer);
  await deps.saveTransfer(transfer);

  if (getAutoAccept(senderCid)) {
    try {
      await acceptTransfer(transfer.id);
      return;
    } catch (error) {
      // Auto-accept now has a reason to refuse: the receiver's size limit.
      // Falling through to the prompt rather than letting this throw, because
      // a throw here would leave the transfer pending with no notification at
      // all — the user would get neither the file nor the offer of it.
      debugLog('AsyncTransfers', 'Auto-accept declined, asking instead:', error);
    }
  }
  eventEmitter.emit(FILE_TRANSFER_EVENTS.REQUEST_RECEIVED, transfer);
}

/**
 * Handle the peer's in-band accept/decline of OUR outgoing offer.
 *
 * The bytes themselves move over the protocol plane (SendFile / ticks); this
 * signal exists because the protocol tells a sender nothing about a decline —
 * see in-band-signals.ts. An accept here is an early 'transferring' (the tick
 * stream confirms it moments later); a decline is the sender's ONLY route to a
 * terminal state.
 *
 * This used to also start a base64 chunk stream on accept — the abandoned
 * message-plane transfer implementation, deleted along with the pending-file
 * stash it read from.
 */
export async function handleTransferResponse(
  deps: AsyncTransferDeps,
  data: FileTransferResponseData & { type: MessagingLayerType.FileTransferResponse },
  _senderCid: string
): Promise<void> {
  const transfer: FileTransfer | undefined = deps.state.getTransfer(data.transfer_id);
  if (!transfer || transfer.isIncoming) return;
  // Never regress a terminal transfer: a late or duplicated response must not
  // resurrect a bubble that already completed, failed or was cancelled. The
  // set is the exported one, not a local list — a hand-rolled copy here
  // omitted 'expired', so an accept arriving after the offer's TTL revived an
  // expired offer to 'transferring' for bytes nobody would ever send.
  if (isTerminalTransferState(transfer.state)) {
    return;
  }

  if (data.accepted) {
    transfer.state = 'transferring';
  } else {
    transfer.state = 'declined';
    transfer.errorMessage = data.decline_reason;
  }

  transfer.updatedAt = Date.now();
  await deps.saveTransfer(transfer);
  deps.emitStateChange(transfer);
}
