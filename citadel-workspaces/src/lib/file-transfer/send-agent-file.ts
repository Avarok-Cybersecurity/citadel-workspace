/**
 * Offering a peer a file the AGENT holds, named by its path on disk.
 *
 * Two producers: the native picker (a file the user chose), and sharing a
 * peer-storage file on request (a file the agent pulled back from RE-VFS --
 * see lib/revfs/share-on-request.ts). Either way the browser never holds the
 * bytes; the agent reads the file itself, and accepts the path only because it
 * handed it out.
 */
import { eventEmitter } from '../event-emitter';
import { getMimeType } from './transfer-format';
import { FILE_TRANSFER_REQUEST_TTL_MS } from '@/types/messaging-layer';
import { FILE_TRANSFER_EVENTS } from './events';
import type { FileTransfer } from './types';
import { debugLog } from '@/lib/debug-config';
import type { LifecycleDeps } from './transfer-lifecycle';

export interface AgentFile {
  path: string;
  name: string;
  size: number;
}

/** Record, announce and send `file` to `recipientCid` as transfer `transferId`. */
export async function sendAgentFile(
  deps: Pick<LifecycleDeps, 'io' | 'state' | 'saveTransfer' | 'emitStateChange'>,
  senderCid: bigint,
  recipientCid: string,
  file: AgentFile,
  transferId: string,
): Promise<string> {
  const transfer: FileTransfer = {
    id: transferId,
    fileName: file.name,
    fileSize: file.size,
    fileType: getMimeType(file.name),
    // 'pending' — nothing is moving yet. The recipient has not accepted, and
    // the protocol tick stream (which is what moves this to 'transferring')
    // only starts once they do.
    state: 'pending',
    progress: 0,
    senderCid: senderCid.toString(),
    recipientCid,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    // Without a deadline an offer whose sender goes offline leaves the
    // recipient a live-looking Accept button forever (expire-transfers.ts never
    // expires a record with no expiresAt). The announcement ships it on.
    expiresAt: Date.now() + FILE_TRANSFER_REQUEST_TTL_MS,
    isIncoming: false,
  };

  deps.state.setTransfer(transfer);
  await deps.saveTransfer(transfer);
  deps.emitStateChange(transfer);

  try {
    await deps.io.executeIntent({
      type: 'send-file-via-protocol',
      cid: senderCid.toString(),
      peerCid: recipientCid,
      filePath: file.path,
      transferId,
      // Carries the record the executor announces to the recipient — the
      // in-band bubble is built from these fields.
      transfer,
    });

    debugLog('transfer-lifecycle', 'SendFile request submitted', { transferId });
    // The executor noted the request id the agent's ticks carry; kept for a reload.
    await deps.saveTransfer(transfer);
    eventEmitter.emit(FILE_TRANSFER_EVENTS.REQUEST_SENT, transfer);
    return transferId;
  } catch (error) {
    transfer.state = 'error';
    transfer.errorMessage = error instanceof Error ? error.message : 'SendFile failed';
    transfer.updatedAt = Date.now();
    await deps.saveTransfer(transfer);
    deps.emitStateChange(transfer);
    throw error;
  }
}
