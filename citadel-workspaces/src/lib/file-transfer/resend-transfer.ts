/**
 * The sender's one click when a reload left nothing to send again by itself.
 *
 * Only for a transfer reload-recovery.ts marked lost on the SENDER's side: its
 * bytes were never kept (too large for this browser to hold, or storage refused
 * them), so the person picks the file once more and it goes as a new transfer to
 * the same peer. The old bubble stops offering the button, so it is one send.
 */
import type { FileTransfer } from './types';

export interface ResendDeps {
  getTransfer: (transferId: string) => FileTransfer | undefined;
  sendFile: (recipientCid: string, file: File) => Promise<string>;
  saveTransfer: (transfer: FileTransfer) => Promise<void>;
  emitStateChange: (transfer: FileTransfer) => void;
}

/** Sends `file` again for the lost `transferId`; resolves to the new transfer's id. */
export async function resendLostTransfer(deps: ResendDeps, transferId: string, file: File): Promise<string> {
  const lost: FileTransfer | undefined = deps.getTransfer(transferId);
  if (lost === undefined || lost.isIncoming || lost.resendable !== true) {
    throw new Error('Only a file you sent that could not be resumed can be sent again from here.');
  }
  const sent: string = await deps.sendFile(lost.recipientCid, file);
  lost.resendable = false;
  lost.updatedAt = Date.now();
  await deps.saveTransfer(lost);
  deps.emitStateChange(lost);
  return sent;
}
