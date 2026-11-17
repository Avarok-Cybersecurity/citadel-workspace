/**
 * Where sharing a peer-storage file meets the file-transfer service.
 *
 * The decisions are in share-on-request.ts (uploader) and request-share.ts
 * (asker); this is only the I/O they are handed.
 */
import { fileTransferService } from '@/lib/file-transfer/service';
import { requestedShares } from '@/lib/file-transfer/requested-shares';
import type { AgentFile } from '@/lib/file-transfer/send-agent-file';
import type { FileTransfer } from '@/lib/file-transfer/types';

export async function sendSharedFile(myCid: bigint, peerCid: bigint, file: AgentFile, transferId: string): Promise<void> {
  await fileTransferService.sendAgentFile(myCid, peerCid.toString(), file, transferId);
}

export function expectShare(transferId: string): Promise<FileTransfer> {
  return requestedShares.expect(transferId);
}

export function forgetShare(transferId: string): void {
  requestedShares.forget(transferId);
}
