/**
 * Delivering a browser file that is already on the sender's screen as a bubble.
 *
 * The send used to run inside the dialog's Send click: for a staged file (up to
 * 2 GB, uploaded to the agent chunk by chunk) the dialog sat on a disabled
 * "Sending..." with no progress and could not be closed, while the offer was
 * already in the recipient's chat -- they could accept bytes that were minutes
 * from existing. Now the bubble appears at once in 'preparing' and shows the
 * staging progress; the offer goes out only once the agent holds the whole file;
 * and the bubble's Cancel stops the staging. Both the immediate send and a held
 * send released later come through here.
 */
import { eventEmitter } from '../event-emitter';
import { FILE_TRANSFER_EVENTS } from './events';
import { isStillOpen } from './transfer-outcome';
import { wrapInMemory, type FileTransfer } from './types';
import type { FileTransferState } from './state';
import type { FileTransferIO } from './io';

export interface DeliverDeps {
  state: FileTransferState;
  io: FileTransferIO;
  emitStateChange: (transfer: FileTransfer) => void;
  saveTransfer: (transfer: FileTransfer) => Promise<void>;
}

/** Staging in progress, by transfer id, so Cancel can stop it. */
const staging: Map<string, AbortController> = new Map();

/** Stops `transferId`'s staging, if it is staging. */
export function stopStaging(transferId: string): void {
  staging.get(transferId)?.abort();
}

/** The staged share of the file, as the bubble's percentage. Pure. */
export function stagingPercent(staged: number, total: number): number {
  return total > 0 ? Math.min(100, Math.floor((staged / total) * 100)) : 0;
}

/** Sends `file` for `transfer`, which is recorded and shown as 'preparing'. Never throws: a failure is the bubble's. */
export async function deliverSend(deps: DeliverDeps, transfer: FileTransfer, file: File): Promise<void> {
  const controller: AbortController = new AbortController();
  staging.set(transfer.id, controller);
  try {
    await deps.io.executeIntent({
      type: 'send-transfer-request', transfer, file: wrapInMemory(file), offerAlreadyShown: true,
      staging: {
        signal: controller.signal,
        onProgress: (staged: number, total: number): void => {
          if (transfer.state !== 'preparing') return;
          transfer.progress = stagingPercent(staged, total);
          deps.emitStateChange(transfer);
        },
        onStaged: (): void => {
          if (transfer.state !== 'preparing') return;
          transfer.state = 'pending';
          transfer.progress = 0;
          transfer.updatedAt = Date.now();
          deps.emitStateChange(transfer);
        },
      },
    });
    await deps.saveTransfer(transfer);
    eventEmitter.emit(FILE_TRANSFER_EVENTS.REQUEST_SENT, transfer);
  } catch (error) {
    // Cancelled from the bubble: cancelTransfer records that outcome.
    if (controller.signal.aborted || !isStillOpen(deps.state, transfer)) return;
    transfer.state = 'error';
    transfer.errorMessage = error instanceof Error ? error.message : 'SendFile failed';
    transfer.updatedAt = Date.now();
    await deps.saveTransfer(transfer);
    deps.emitStateChange(transfer);
  } finally {
    staging.delete(transfer.id);
  }
}
