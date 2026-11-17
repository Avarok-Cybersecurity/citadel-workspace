/**
 * Terminal-state transitions for a file transfer.
 *
 * Extracted from p2p-transfers to keep that module under the file cap.
 */
import { eventEmitter } from '../event-emitter';
import { FILE_TRANSFER_EVENTS } from './events';
import type { FileTransferState as TransferLifecycleState } from '@/types/messaging-layer';
import type { P2PTransferDeps } from './p2p-transfers';
import type { FileTransfer } from '@/lib/file-transfer/types';

/**
 * States a transfer can never leave. 'declined' and 'expired' belong here as
 * much as the other three: a declined offer whose stray tick could still
 * "complete" it would resurrect a transfer both sides agreed was over.
 */
const TERMINAL_STATES: ReadonlySet<TransferLifecycleState> = new Set([
  'complete', 'error', 'cancelled', 'declined', 'expired',
]);

export function isTerminalTransferState(state: TransferLifecycleState): boolean {
  return TERMINAL_STATES.has(state);
}

/**
 * The one place a transfer becomes terminal with an outcome. Success and
 * failure can be reported more than once — the protocol's completion tick, the
 * accept-failure status notification, and a Fail tick can all describe the
 * same transfer — and two reports must not produce two COMPLETED events or two
 * saves, so an already-terminal transfer is a no-op: whichever report arrives
 * first wins and the rest are ignored.
 */
export async function applyTransferOutcome(
  deps: P2PTransferDeps,
  transferId: string,
  outcome: { success: boolean; downloadPath?: string; errorMessage?: string }
): Promise<void> {
  const transfer: FileTransfer | undefined = deps.state.getTransfer(transferId);
  if (!transfer) return;
  if (isTerminalTransferState(transfer.state)) return;

  if (outcome.success) {
    transfer.state = 'complete';
    // A page that reloaded mid-reception lost the path with the tick that named
    // it; the record kept it (protocol-transfer-events.ts).
    transfer.downloadPath = outcome.downloadPath ?? transfer.downloadPath;
    transfer.progress = 100;
  } else {
    transfer.state = 'error';
    transfer.errorMessage = outcome.errorMessage;
  }

  transfer.updatedAt = Date.now();
  await deps.saveTransfer(transfer);
  deps.emitStateChange(transfer);
  eventEmitter.emit(FILE_TRANSFER_EVENTS.COMPLETED, transfer);
}

/**
 * Whether a caller resuming from an await may still write a NON-terminal state
 * to `transfer`. The protocol plane can finish a transfer while the caller is
 * suspended — a one-group file lands inside the accept signal's P2P round trip —
 * and the expiry sweep replaces a record rather than mutating it. Writing
 * 'transferring' over either left a finished download on "Downloading… 100%"
 * for good, because 'complete' is terminal and nothing corrects it.
 */
export function isStillOpen(
  state: { getTransfer(transferId: string): FileTransfer | undefined },
  transfer: FileTransfer
): boolean {
  return state.getTransfer(transfer.id) === transfer && !isTerminalTransferState(transfer.state);
}

/**
 * Whether a transfer can still be accepted. An unknown one counts: an offer's
 * message half is noted before its transfer is recorded (see the service), so
 * absent means "arriving", and only a recorded outcome closes it.
 */
export function isOpenTransfer(transfer: FileTransfer | undefined): boolean {
  return transfer === undefined || !isTerminalTransferState(transfer.state);
}
