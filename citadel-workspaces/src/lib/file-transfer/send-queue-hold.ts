/**
 * Holding a send for an offline peer, and releasing it when they are back.
 * The decisions are send-queue.ts; this applies them to the transfer record.
 */
import { eventEmitter } from '../event-emitter';
import { FILE_TRANSFER_EVENTS } from './events';
import { buildTransferAnnouncement } from './transfer-announcement';
import { showOwnOffer } from './send-transfer-request';
import { canKeepBytes, queueRefusal, queuedFor } from './send-queue';
import { isTerminalTransferState } from './transfer-outcome';
import type { FileTransfer } from './types';
import { deliverSend } from './deliver-send';
import type { FileTransferState } from './state';
import type { FileTransferIO } from './io';
import { LOST_SEND_REASON } from './reload-recovery';

/** Where held Files live, and what is known about the peer. */
export interface SendQueuePort {
  /** True / false from the presence poll; null before one has landed. */
  peerOnlineStatus: (peerCid: bigint) => boolean | null;
  peerName: (peerCid: string) => string;
  /** Keeps the File; true when it will survive a reload (stored, not only in memory). */
  hold: (transferId: string, file: File) => Promise<boolean>;
  /** The held File, or undefined when it was not kept (e.g. storage refused it before a reload). */
  take: (transferId: string) => Promise<File | undefined>;
  release: (transferId: string) => Promise<void>;
}

export interface HoldDeps {
  state: FileTransferState;
  io: FileTransferIO;
  queue: SendQueuePort;
  emitStateChange: (transfer: FileTransfer) => void;
  saveTransfer: (transfer: FileTransfer) => Promise<void>;
}

/** Hold `transfer` (not yet recorded) until its recipient is online. */
export async function holdUntilOnline(deps: HoldDeps, transfer: FileTransfer, file: File): Promise<string> {
  const refusal: string | null = queueRefusal(deps.state.getAllTransfers(), file.size);
  if (refusal !== null) throw new Error(refusal);
  transfer.state = 'queued';
  transfer.waitingFor = deps.queue.peerName(transfer.recipientCid);
  deps.state.setTransfer(transfer);
  transfer.bytesKept = await deps.queue.hold(transfer.id, file);
  await deps.saveTransfer(transfer);
  showOwnOffer(buildTransferAnnouncement(transfer), transfer);
  deps.emitStateChange(transfer);
  eventEmitter.emit(FILE_TRANSFER_EVENTS.REQUEST_SENT, transfer);
  return transfer.id;
}

/**
 * Keeps the bytes of a send that goes now, within the budget, so that a reload
 * before the agent confirms it can send it again by itself (reload-recovery.ts).
 * Runs beside the send: the bubble does not wait for storage.
 */
export async function keepForResume(deps: HoldDeps, transfer: FileTransfer, file: File): Promise<void> {
  if (!canKeepBytes(deps.state.getAllTransfers(), file.size)) return;
  const kept: boolean = await deps.queue.hold(transfer.id, file);
  // Ended while it was being stored: the drop on that ending has already run.
  if (isTerminalTransferState(transfer.state)) {
    await deps.queue.release(transfer.id);
    return;
  }
  if (!kept) return;
  transfer.bytesKept = true;
  await deps.saveTransfer(transfer);
}

async function failLost(deps: HoldDeps, transfer: FileTransfer): Promise<void> {
  transfer.state = 'error';
  transfer.errorMessage = LOST_SEND_REASON;
  transfer.resendable = true;
  transfer.resuming = false;
  transfer.updatedAt = Date.now();
  await deps.saveTransfer(transfer);
  deps.emitStateChange(transfer);
}

/** Send every send held for `peerCid` by `ownCid`, oldest first. */
export async function releaseHeldSends(deps: HoldDeps, ownCid: string, peerCid: string): Promise<void> {
  for (const transfer of queuedFor(deps.state.getAllTransfers(), ownCid, peerCid)) {
    const file: File | undefined = await deps.queue.take(transfer.id);
    if (file === undefined) {
      await failLost(deps, transfer);
      continue;
    }
    transfer.state = 'preparing';
    transfer.resuming = false;
    transfer.updatedAt = Date.now();
    await deps.saveTransfer(transfer);
    deps.emitStateChange(transfer);
    // A failure here is the bubble's, recorded by deliverSend. The File stays
    // kept until the transfer ends (send-queue-io.ts drops it then), so a reload
    // before the agent confirms the send can still send it again.
    await deliverSend(deps, transfer, file);
  }
}
