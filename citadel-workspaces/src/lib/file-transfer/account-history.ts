/**
 * Loading an account's transfer history once the tab knows the account.
 *
 * The history is stored under an account-scoped key, and the service loads it
 * at module import, when no session exists yet. That read therefore used the
 * bare legacy key, and nothing read the scoped one afterwards: after a reload
 * every transfer record was gone, so the chat's Stats tab said "0 Files
 * Transferred" beside the bubbles of files it had sent.
 *
 * Adds only what memory lacks. A live record is newer than its persisted
 * snapshot and must not be overwritten by it.
 */
import { eventEmitter } from '../event-emitter';
import { FILE_TRANSFER_EVENTS } from './events';
import { loadPersistedTransfers } from './transfer-persistence';
import type { FileTransfer, FileTransferSettings } from './types';

export interface TransferHistoryState {
  getTransfer(transferId: string): FileTransfer | undefined;
  setTransfer(transfer: FileTransfer): void;
  setSettings(peerCid: string, settings: FileTransferSettings): void;
}

export function loadMissingTransfers(state: TransferHistoryState): Promise<void> {
  return loadPersistedTransfers({
    // Announced, because bubbles have usually rendered by now: without the
    // event they keep showing what they decided while the record was absent.
    setTransfer: (t: FileTransfer): void => {
      if (state.getTransfer(t.id)) return;
      state.setTransfer(t);
      eventEmitter.emit(FILE_TRANSFER_EVENTS.STATE_CHANGED, t);
    },
    setSettings: (peerCid: string, s: FileTransferSettings): void => state.setSettings(peerCid, s),
  });
}

export function bindAccountHistory(state: TransferHistoryState): void {
  eventEmitter.on('instance:cid-changed', (data: { cid: bigint | null }) => {
    if (data.cid === null) return;
    void loadMissingTransfers(state);
  });
}

/** What the Stats tab counts: transfers that finished, not ones offered, declined or failed. */
export function completedTransferCount(transfers: FileTransfer[]): number {
  return transfers.filter((t: FileTransfer) => t.state === 'complete').length;
}
