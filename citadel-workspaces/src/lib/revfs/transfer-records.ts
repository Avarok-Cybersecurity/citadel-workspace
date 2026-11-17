/**
 * Chat transfers -> the file manager's Sent Files / Received Files.
 *
 * `addSentFile` / `addReceivedFile` existed with tests and no production
 * caller, so both folders stayed empty however many files were sent. This is
 * the caller: a pure decision (what to record, for which account pair) and a
 * thin subscription to the transfer service's COMPLETED event.
 *
 * Account-scoped by construction: both cids come from the transfer itself,
 * never from "the current user", because one browser hosts several accounts
 * and a completion can arrive for a tab's non-selected session.
 */
import { eventEmitter } from '@/lib/event-emitter';
import { FILE_TRANSFER_EVENTS } from '@/lib/file-transfer/events';
import type { FileTransfer } from '@/lib/file-transfer/types';
import { debugLog } from '@/lib/debug-config';

export interface RecordEntry {
  fileName: string;
  fileSize: number;
  fileType: string;
  transferId: string;
  downloadPath?: string;
}

export type TransferRecord =
  | { kind: 'sent'; myCid: bigint; peerCid: bigint; entry: RecordEntry }
  | { kind: 'received'; myCid: bigint; peerCid: bigint; entry: RecordEntry };

/** What `transfer` should add to the file manager, or null for nothing. */
export function recordForCompletedTransfer(transfer: FileTransfer): TransferRecord | null {
  // COMPLETED also fires for failures (applyTransferOutcome); only a delivered
  // file belongs in either folder.
  if (transfer.state !== 'complete') return null;
  const entry: RecordEntry = {
    fileName: transfer.fileName,
    fileSize: transfer.fileSize,
    fileType: transfer.fileType,
    transferId: transfer.id,
  };
  const sender: bigint = BigInt(transfer.senderCid);
  const recipient: bigint = BigInt(transfer.recipientCid);
  if (transfer.isIncoming) {
    return {
      kind: 'received', myCid: recipient, peerCid: sender,
      entry: transfer.downloadPath === undefined ? entry : { ...entry, downloadPath: transfer.downloadPath },
    };
  }
  return { kind: 'sent', myCid: sender, peerCid: recipient, entry };
}

export interface RecordSink {
  addSentFile(myCid: bigint, peerCid: bigint, entry: RecordEntry): Promise<void>;
  addReceivedFile(myCid: bigint, peerCid: bigint, entry: RecordEntry): Promise<void>;
}

/** Subscribe `sink` to completed transfers. Returns the unsubscribe. */
export function wireTransferRecords(sink: RecordSink): () => void {
  return eventEmitter.on<FileTransfer>(FILE_TRANSFER_EVENTS.COMPLETED, (transfer): void => {
    const record: TransferRecord | null = recordForCompletedTransfer(transfer);
    if (record === null) return;
    const write: Promise<void> = record.kind === 'sent'
      ? sink.addSentFile(record.myCid, record.peerCid, record.entry)
      : sink.addReceivedFile(record.myCid, record.peerCid, record.entry);
    write.catch((error: unknown): void => {
      // The transfer itself succeeded; only its listing failed. Said, not
      // thrown: a throw here would be an unhandled rejection in an emitter.
      console.warn(`[revfs] could not list ${record.kind} file "${record.entry.fileName}" (${record.entry.transferId})`, error);
      debugLog('RevfsService', 'transfer record failed', error);
    });
  });
}
