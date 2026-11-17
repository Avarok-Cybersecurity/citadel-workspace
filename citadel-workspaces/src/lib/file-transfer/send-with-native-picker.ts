/**
 * Sending a file the user picked through the NATIVE picker.
 *
 * Distinct enough from `sendFile` to live apart: the browser never holds these
 * bytes. The service reads the file from disk itself and the browser only ever
 * sees a path and a size, so none of the in-memory reasoning that governs
 * `sendFile` — the inline-payload cap, the empty-File refusal, the
 * `InMemoryOnly` brand — applies here.
 */
import { debugLog } from '@/lib/debug-config';
import { FILE_TRANSFER_REQUEST_TTL_MS } from '@/types/messaging-layer';
import { sendAgentFile } from './send-agent-file';
import { openChannelBeforeSending } from './open-peer-channel';
import { shouldQueue } from './send-queue';
import { getMimeType } from './transfer-format';
import { buildTransferAnnouncement } from './transfer-announcement';
import { showOwnOffer } from './send-transfer-request';
import type { FileTransfer } from './types';
import type { LifecycleDeps } from './transfer-lifecycle';

/**
 * Why a picked file was not sent to an unreachable peer. The offline hold keeps
 * browser Files (in memory and IndexedDB); a picked file is a path on the agent,
 * valid for a while, that the hold cannot keep -- so it says so, in the bubble.
 */
export function unreachableReason(peerName: string): string {
  return `${peerName} is offline, and a file chosen with Browse Files cannot wait for them. ` +
    'Send it when they are back, or drop it on the chat to have it wait.';
}

export async function sendFileWithNativePicker(
  deps: LifecycleDeps,
  recipientCid: string,
  title?: string,
  allowedExtensions?: string[]
): Promise<string> {
  const senderCid: bigint | null = await deps.io.getCurrentCid();
  if (!senderCid) {
    throw new Error('No active session');
  }
  // Only an agent that SAID it has no picker is refused: one that said nothing is an older agent.
  // The words are the ones the send dialog already reads as "no picker here".
  if ((await deps.agentNativePicker?.()) === false) throw new Error('File picker not available: this agent has no desktop session to show it in');

  // Opened while the user picks; its answer decides what happens to the pick. It was
  // awaited and dropped, so a send to an unreachable peer went ahead regardless.
  const peerOnline: boolean | null = deps.queue.peerOnlineStatus(BigInt(recipientCid));
  const opening: Promise<boolean> = peerOnline === false ? Promise.resolve(false) : openChannelBeforeSending(deps, recipientCid);
  debugLog('transfer-lifecycle', 'Starting native file picker flow');

  const fileInfo: { file_path: string; file_name: string; file_size: bigint; } = (await deps.io.executeIntent({
    type: 'pick-file',
    cid: senderCid,
    title,
    allowedExtensions,
  })) as { file_path: string; file_name: string; file_size: bigint };

  debugLog('transfer-lifecycle', 'File picked', {
    path: fileInfo.file_path,
    name: fileInfo.file_name,
    size: fileInfo.file_size.toString(),
  });

  if (shouldQueue(peerOnline, await opening)) {
    return showUnreachable(deps, senderCid, recipientCid, fileInfo.file_name, Number(fileInfo.file_size));
  }

  return sendAgentFile(
    deps,
    senderCid,
    recipientCid,
    { path: fileInfo.file_path, name: fileInfo.file_name, size: Number(fileInfo.file_size) },
    crypto.randomUUID(),
  );
}

/** The picked file's bubble, failed with the reason; nothing is offered or sent. */
async function showUnreachable(
  deps: LifecycleDeps, senderCid: bigint, recipientCid: string, name: string, size: number,
): Promise<string> {
  const transfer: FileTransfer = {
    id: crypto.randomUUID(), fileName: name, fileSize: size, fileType: getMimeType(name),
    state: 'error', errorMessage: unreachableReason(deps.queue.peerName(recipientCid)), progress: 0,
    senderCid: senderCid.toString(), recipientCid, createdAt: Date.now(), updatedAt: Date.now(),
    expiresAt: Date.now() + FILE_TRANSFER_REQUEST_TTL_MS, isIncoming: false,
  };
  deps.state.setTransfer(transfer);
  await deps.saveTransfer(transfer);
  showOwnOffer(buildTransferAnnouncement(transfer), transfer);
  deps.emitStateChange(transfer);
  return transfer.id;
}
