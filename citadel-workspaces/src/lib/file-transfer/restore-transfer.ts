/**
 * Bringing a persisted transfer back after a reload, honestly.
 *
 * Every transfer is written to `citadel:file-transfers` and nothing read it
 * back, so a reload lost all of them while the message bubble kept rendering
 * from the message record. Accept, Decline and Cancel then threw "Transfer not
 * found" — a sentence that is false about the world: the agent still had it,
 * and the browser had forgotten a record it explicitly persisted. The user
 * could not even dismiss the bubble.
 *
 * Restoring is not always resuming, and not always failing either: the agent
 * outlives the page, so a transfer it holds is picked up again rather than
 * declared dead (reload-recovery.ts decides how). Terminal ones come back as
 * they were, so history survives.
 */

import type { FileTransfer } from './types';
import type { FileTransferState } from '@/types/messaging-layer';
import { LOST_OFFER_REASON, LOST_RECEPTION_REASON, LOST_SEND_REASON, reloadRecovery, type ReloadRecovery } from './reload-recovery';

/** States that describe a finished transfer. Anything else was moving. */
const TERMINAL: ReadonlySet<FileTransferState> = new Set<FileTransferState>([
  'complete',
  'declined',
  'cancelled',
  'expired',
  'error',
]);

/** Fields without which a transfer cannot be rendered or acted on. */
function isUsable(raw: Partial<FileTransfer>): raw is Partial<FileTransfer> & {
  id: string;
  fileName: string;
  state: FileTransferState;
} {
  return (
    typeof raw.id === 'string' &&
    raw.id !== '' &&
    typeof raw.fileName === 'string' &&
    typeof raw.state === 'string'
  );
}

export function restoreTransfer(raw: Partial<FileTransfer>): FileTransfer | null {
  if (!isUsable(raw)) return null;

  const base: FileTransfer = {
    id: raw.id,
    fileName: raw.fileName,
    fileSize: raw.fileSize ?? 0,
    fileType: raw.fileType ?? '',
    state: raw.state,
    progress: raw.progress ?? 100,
    senderCid: raw.senderCid ?? '',
    recipientCid: raw.recipientCid ?? '',
    isIncoming: raw.isIncoming ?? false,
    createdAt: raw.createdAt ?? Date.now(),
    updatedAt: raw.updatedAt ?? Date.now(),
    ...(raw.expiresAt !== undefined ? { expiresAt: raw.expiresAt } : {}),
    ...(raw.tickRequestId !== undefined ? { tickRequestId: raw.tickRequestId } : {}),
    ...(raw.objectId !== undefined ? { objectId: raw.objectId } : {}),
    ...(raw.bytesKept !== undefined ? { bytesKept: raw.bytesKept } : {}),
    ...(raw.offerMessageId !== undefined ? { offerMessageId: raw.offerMessageId } : {}),
    // Where the internal service writes (or wrote) the file on its own disk.
    // Dropped here before, so after a reload the "Click to open file" control
    // rendered and operated on nothing. FilesSection surfaces it as `savedTo`.
    ...(raw.downloadPath !== undefined ? { downloadPath: raw.downloadPath } : {}),
  };

  // History, and a send held for an offline peer (its File is kept,
  // send-queue-io.ts; releasing it finds out whether the File survived).
  if (TERMINAL.has(raw.state) || raw.state === 'queued') {
    return {
      ...base,
      progress: raw.state === 'queued' ? 0 : base.progress,
      ...(raw.state === 'queued' && raw.waitingFor !== undefined ? { waitingFor: raw.waitingFor } : {}),
      ...(raw.errorMessage !== undefined ? { errorMessage: raw.errorMessage } : {}),
      ...(raw.resendable === true ? { resendable: true } : {}),
    };
  }

  const recovery: ReloadRecovery = reloadRecovery({ ...base, state: raw.state });
  return base.isIncoming ? restoreIncoming(base, recovery) : restoreOutgoing(base, recovery);
}

function restoreIncoming(t: FileTransfer, recovery: ReloadRecovery): FileTransfer {
  if (t.state === 'pending') {
    // The agent still holds the offer and we kept the object_id Accept names.
    return recovery === 'reattach'
      ? { ...t, progress: 0 }
      : { ...t, state: 'expired', progress: 0, errorMessage: LOST_OFFER_REASON };
  }
  // Accepted: the agent is still receiving, under the request id we kept.
  if (recovery === 'reattach') return { ...t, state: 'transferring', resuming: true };
  // A path for a file that never finished is not one to offer to open.
  const { downloadPath: _unfinished, ...rest } = t;
  return { ...rest, state: 'error', progress: 0, errorMessage: LOST_RECEPTION_REASON };
}

function restoreOutgoing(t: FileTransfer, recovery: ReloadRecovery): FileTransfer {
  switch (recovery) {
    case 'reattach':
      // Still offered, or still moving, in the agent. A pending offer has
      // nothing to resume -- it is waiting for its answer, as before.
      return t.state === 'transferring' ? { ...t, resuming: true } : { ...t, progress: 0 };
    case 'resend':
      return { ...t, state: 'queued', progress: 0, resuming: true };
    case 'lost':
      return { ...t, state: 'error', progress: 0, errorMessage: LOST_SEND_REASON, resendable: true };
  }
}
