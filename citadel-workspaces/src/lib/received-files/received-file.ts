/**
 * Opening a file someone sent you, the way Slack does: the browser downloads the original, under
 * its original name, as a Blob of what its bytes are.
 *
 * The agent saved the file on its own disk; the page knows only that path (downloadPath). It
 * used to show the path, the only thing it had. The agent now records an accepted chat file as
 * readable by that path (citadel-internal-service kernel/received_reads.rs), so the bytes are
 * read over ReadPulledFileChunk and handed to the browser.
 *
 * Pure over its I/O (SBIO): the chunk read and the save are handed in.
 */
import type { FileTransfer } from '@/lib/file-transfer/types';
import type { SavedFile } from '@/lib/document-files';
import type { PulledChunk } from '@/types/revfs-intents';
import { MAX_PULLED_FILE_BYTES, readAgentFile } from '@/components/file-manager/pulled-file-reader';
import { safeDownloadName } from './download-name';
import { blobTypeFor } from './blob-type';

/** Where a received file's bytes are: the session that received it, from whom, at which path. */
export interface ReceivedFileAsk {
  readonly cid: bigint;
  readonly peerCid: bigint;
  readonly savedPath: string;
}

export interface ReceivedFileIO {
  readonly readChunk: (ask: ReceivedFileAsk, offset: bigint, maxLen: number) => Promise<PulledChunk>;
  readonly save: (file: SavedFile) => void;
}

export type ReceivedFileRead =
  | { readonly kind: 'read'; readonly file: SavedFile }
  | { readonly kind: 'unreadable'; readonly reason: string };

/** Where a completed incoming transfer's bytes are, or why there is no asking. */
export function receivedFileAsk(transfer: FileTransfer): ReceivedFileAsk | string {
  if (!transfer.isIncoming) return 'This file was sent from this device.';
  if (!transfer.downloadPath) return 'This device has no record of where the agent saved this file.';
  return { cid: BigInt(transfer.recipientCid), peerCid: BigInt(transfer.senderCid), savedPath: transfer.downloadPath };
}

/** The received file's bytes, typed and named for the browser, read through `io`. */
export async function readReceivedFile(transfer: FileTransfer, io: ReceivedFileIO, limit: bigint): Promise<ReceivedFileRead> {
  const ask: ReceivedFileAsk | string = receivedFileAsk(transfer);
  if (typeof ask === 'string') return { kind: 'unreadable', reason: ask };
  try {
    const bytes: Uint8Array = await readAgentFile(transfer.fileName, (offset: bigint, maxLen: number): Promise<PulledChunk> => io.readChunk(ask, offset, maxLen), limit);
    return { kind: 'read', file: { bytes, mime: blobTypeFor(bytes, transfer.fileName), name: safeDownloadName(transfer.fileName) } };
  } catch (error: unknown) {
    return { kind: 'unreadable', reason: error instanceof Error ? error.message : String(error) };
  }
}

/** Downloads the received file through the browser, or says why it could not. */
export async function openReceivedFile(transfer: FileTransfer, io: ReceivedFileIO): Promise<ReceivedFileRead> {
  const read: ReceivedFileRead = await readReceivedFile(transfer, io, MAX_PULLED_FILE_BYTES);
  if (read.kind === 'read') io.save(read.file);
  return read;
}
