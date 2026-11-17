/**
 * Peer-signal handlers for the message plane that REMAINS in use.
 *
 * This module once held a whole second transfer implementation — base64
 * chunking over P2P messages, with streaming, reassembly and its own progress
 * events. That plane was never wired: nothing ever emitted a
 * FileTransferChunk/Progress message (their constructors had zero callers), so
 * the handlers were subscribed decoys and the real bytes always travelled over
 * the protocol's own SendFile. The dead plane has been deleted; the protocol
 * plane's progress/completion now drives state via protocol-transfer-events.ts.
 *
 * What stays is the one in-band signal the protocol cannot express: CANCEL.
 * The SDK has no cancel command (cancellation is implicit in disconnect), so
 * the cancelling side sends a FileTransferCancel message (in-band-signals.ts)
 * and this handler moves the peer's bubble to its terminal state.
 */

import { eventEmitter } from '../event-emitter';
import type {
  MessagingLayerType, FileTransferCancelData,
} from '@/types/messaging-layer';
import { FILE_TRANSFER_EVENTS } from './events';
import type { FileTransferState } from './state';
import type { FileTransferIO } from './io';
import type { FileTransfer } from './types';
import { applyTransferOutcome, isTerminalTransferState } from './transfer-outcome';

export interface P2PTransferDeps {
  state: FileTransferState;
  io: FileTransferIO;
  emitStateChange: (transfer: FileTransfer) => void;
  saveTransfer: (transfer: FileTransfer) => Promise<void>;
}

export async function handleTransferCancel(
  deps: P2PTransferDeps,
  data: FileTransferCancelData & { type: MessagingLayerType.FileTransferCancel },
  _senderCid: string
): Promise<void> {
  const transfer: FileTransfer | undefined = deps.state.getTransfer(data.transfer_id);
  if (!transfer) return;
  // A cancel that races the completion loses: once the bytes have fully
  // arrived (or the transfer already failed), rewriting the outcome would
  // make the two sides disagree about what happened. The exported terminal
  // set, not a local list — the hand-rolled copy here omitted 'expired', so a
  // late cancel rewrote an expired offer's history to 'cancelled'.
  if (isTerminalTransferState(transfer.state)) {
    return;
  }

  // The peer's side FAILED (it says so; older peers only ever cancel). The
  // sender showed this as "cancelled", as if someone had chosen to stop.
  if (data.failed === true) {
    await applyTransferOutcome(deps, transfer.id, { success: false, errorMessage: data.reason });
    return;
  }

  transfer.state = 'cancelled';
  transfer.errorMessage = data.reason;
  transfer.updatedAt = Date.now();
  await deps.saveTransfer(transfer);

  deps.emitStateChange(transfer);
  eventEmitter.emit(FILE_TRANSFER_EVENTS.CANCELLED, transfer);
}
