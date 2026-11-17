/**
 * Business logic for the PROTOCOL plane's progress/completion notifications —
 * the plane that actually moves bytes (SendFile / RespondFileTransfer /
 * FileTransferTickNotification, backed by the Rust internal service).
 *
 * The router (real-protocol-io-router.ts) resolves a tick to an exact
 * transferId whenever the wire allows it. When it cannot — sender-side
 * streams carry no id of any kind, see tick-events.ts — the event arrives
 * here with only (cid, peerCid, direction), and we fall back to matching the
 * oldest live transfer for that peer pair and direction.
 *
 * Wire limitation, stated plainly: two CONCURRENT sends to the same peer are
 * indistinguishable on the sender's side. Their ticks interleave onto
 * whichever transfer is oldest, and the first completion tick closes it. The
 * fix belongs in the internal service (thread object_id through
 * ObjectTransferStatus); until then this is the best the browser can know.
 */

import { eventEmitter } from '../event-emitter';
import { FILE_TRANSFER_EVENTS } from './events';
import type {
  TransferProgressEvent, TransferCompleteEvent, TransferStatusEvent,
} from './io-router-types';
import type { FileTransferState } from './state';
import type { FileTransfer } from './types';
import type { P2PTransferDeps } from './p2p-transfers';
import { applyTransferOutcome, isTerminalTransferState } from './transfer-outcome';

/** The side of the transfer that is US, which the notification's cid names. */
function ownCidOf(transfer: FileTransfer): string {
  return transfer.isIncoming ? transfer.recipientCid : transfer.senderCid;
}

/** The other side, which the notification's peer_cid names. */
function peerCidOf(transfer: FileTransfer): string {
  return transfer.isIncoming ? transfer.senderCid : transfer.recipientCid;
}

function matchesDirection(
  transfer: FileTransfer,
  direction: 'outgoing' | 'incoming' | 'unknown'
): boolean {
  if (direction === 'unknown') return true;
  return direction === 'incoming' ? transfer.isIncoming : !transfer.isIncoming;
}

/**
 * Resolve the transfer a protocol event belongs to: exactly by id when the
 * router could join it, otherwise the OLDEST live transfer matching the
 * event's session, peer and direction (streams start in the order the
 * transfers were offered).
 */
export function resolveTransferForProtocolEvent(
  state: FileTransferState,
  event: { transferId?: string; cid: bigint; peerCid: bigint; direction: 'outgoing' | 'incoming' | 'unknown' }
): FileTransfer | undefined {
  if (event.transferId) {
    const exact: FileTransfer | undefined = state.getTransfer(event.transferId);
    if (exact) return exact;
  }

  const own: string = event.cid.toString();
  const peer: string = event.peerCid.toString();
  return state
    .getAllTransfers()
    .filter(
      (t) =>
        !isTerminalTransferState(t.state) &&
        // A held send has not started a protocol stream, so no tick is its.
        t.state !== 'queued' &&
        matchesDirection(t, event.direction) &&
        ownCidOf(t) === own &&
        peerCidOf(t) === peer
    )
    .sort((a, b) => a.createdAt - b.createdAt)[0];
}

/**
 * A tick arrived: the transfer is demonstrably moving. Pull it into
 * 'transferring' if the accept signal has not done so yet, and publish the
 * percentage everywhere the UI reads it (progress callbacks, the event bus,
 * and the conversation bubble via emitStateChange).
 */
export async function handleProtocolProgress(
  deps: P2PTransferDeps,
  event: TransferProgressEvent
): Promise<void> {
  const transfer: FileTransfer | undefined = resolveTransferForProtocolEvent(deps.state, event);
  if (!transfer || isTerminalTransferState(transfer.state)) return;

  // Heard from: a transfer picked up after a reload is moving again.
  transfer.resuming = false;
  const learnedPath: boolean = event.downloadPath !== undefined && transfer.downloadPath === undefined;
  if (learnedPath) transfer.downloadPath = event.downloadPath;
  if (transfer.state !== 'transferring' || learnedPath) {
    transfer.state = 'transferring';
    // Persist the state transition, but not every tick — a per-tick save
    // would hammer storage for no recoverable benefit.
    await deps.saveTransfer(transfer);
  }
  transfer.progress = event.percentage;
  transfer.updatedAt = Date.now();

  deps.state.notifyProgressCallbacks(transfer.id, {
    transferId: transfer.id,
    bytesTransferred: event.bytesTransferred,
    totalBytes: event.totalBytes,
    percentage: event.percentage,
  });
  eventEmitter.emit(FILE_TRANSFER_EVENTS.PROGRESS_UPDATED, {
    transfer,
    progress: { percentage: event.percentage },
  });
  deps.emitStateChange(transfer);
}

/**
 * The stream's verdict: TransferComplete / ReceptionComplete / Fail. Routed
 * through applyTransferOutcome, whose terminal guard makes duplicate or
 * conflicting reports a no-op.
 */
export async function handleProtocolComplete(
  deps: P2PTransferDeps,
  event: TransferCompleteEvent
): Promise<void> {
  const transfer: FileTransfer | undefined = resolveTransferForProtocolEvent(deps.state, event);
  if (!transfer) return;
  const wasOpen: boolean = !isTerminalTransferState(transfer.state);
  await applyTransferOutcome(deps, transfer.id, {
    success: event.success,
    downloadPath: event.downloadPath,
    errorMessage: event.errorMessage,
  });
  // A reception that fails here is invisible to the sender otherwise: its
  // bubble stayed "Sending…" or "waiting for acceptance" for a file that
  // was never going to arrive.
  if (wasOpen && !event.success && transfer.isIncoming) {
    await tellPeerItFailed(deps, transfer);
  }
  // And a success, for a peer page that reloaded across the last tick and so
  // never heard it (in-band-signals.ts, sendTransferCompleteSignal).
  if (wasOpen && event.success && transfer.state === 'complete') {
    await deps.io.executeIntent({ type: 'send-complete', transferId: transfer.id, targetCid: BigInt(peerCidOf(transfer)) });
  }
}

/**
 * Only this side saw the failure, so only this side learns of it unless it is
 * said. The local reason stays local: it can name this machine's paths or
 * configuration.
 */
async function tellPeerItFailed(deps: P2PTransferDeps, transfer: FileTransfer): Promise<void> {
  await deps.io.executeIntent({
    type: 'send-cancel',
    transferId: transfer.id,
    targetCid: peerCidOf(transfer),
    reason: 'The transfer failed on the other device.',
    failed: true,
  });
}

/**
 * The internal service's verdict on OUR RespondFileTransfer. A failed accept
 * (e.g. "Connection not found", "File transfer not found") would otherwise
 * leave the recipient's bubble on "Downloading… 0%" forever — that exact
 * silence is how the cid-0 accept bug stayed invisible. A successful accept
 * confirms 'transferring'.
 */
export async function handleProtocolStatus(
  deps: P2PTransferDeps,
  event: TransferStatusEvent
): Promise<void> {
  // Status notifications always carry the object_id; if it never joined to a
  // transfer of ours, the response belongs to another consumer (e.g. revfs).
  if (!event.transferId) return;
  const transfer: FileTransfer | undefined = deps.state.getTransfer(event.transferId);
  if (!transfer) return;

  if (!event.success) {
    if (isTerminalTransferState(transfer.state)) return;
    await applyTransferOutcome(deps, transfer.id, {
      success: false,
      errorMessage: event.message ?? 'The Citadel agent rejected the transfer response.',
    });
    await tellPeerItFailed(deps, transfer);
    return;
  }

  if (event.accepted && !isTerminalTransferState(transfer.state) && transfer.state !== 'transferring') {
    transfer.state = 'transferring';
    transfer.updatedAt = Date.now();
    await deps.saveTransfer(transfer);
    deps.emitStateChange(transfer);
  }
}
