/** Transfer Lifecycle - state machine transitions and core operations. */

import { eventEmitter } from '../event-emitter';
import { scopedSettingsKey } from './settings-key';
import { getMimeType, formatBytes } from './transfer-format';
import { FILE_TRANSFER_REQUEST_TTL_MS } from '@/types/messaging-layer';
import { FILE_TRANSFER_EVENTS } from './events';
import { isTerminalTransferState, isStillOpen } from './transfer-outcome';
import type { FileTransferState } from './state';
import type { FileTransferIO } from './io';
import type { FileTransfer, FileTransferSettings } from './types';
import { openChannelBeforeSending } from './open-peer-channel';
import { shouldQueue } from './send-queue';
import { holdUntilOnline, keepForResume, type SendQueuePort } from './send-queue-hold';
import { deliverSend, stopStaging } from './deliver-send';
import { buildTransferAnnouncement } from './transfer-announcement';
import { showOwnOffer } from './send-transfer-request';
import { browserSendRefusal } from './staged-upload/send-route';
import { debugLog } from '@/lib/debug-config';

export interface LifecycleDeps {
  state: FileTransferState;
  io: FileTransferIO;
  emitStateChange: (transfer: FileTransfer) => void;
  saveTransfer: (transfer: FileTransfer) => Promise<void>;
  saveSettings: (peerCid: string, settings: FileTransferSettings) => Promise<void>;
  /** Opens the peer's P2P channel if needed; resolves whether it opened. See open-peer-channel. */
  openPeerChannel: (peerCid: bigint) => Promise<boolean>;
  /** Holds a send for an offline peer; see send-queue.ts. */
  queue: SendQueuePort;
  /** Whether the agent stages browser files (its greeting); decides the ceiling. */
  agentStagesUploads: () => Promise<boolean>;
  /** Whether the agent can open a native file dialog (its greeting); absent means not asked. */
  agentNativePicker?: () => Promise<boolean | undefined>;
}

export async function sendFile(
  deps: LifecycleDeps,
  recipientCid: string,
  file: File,
): Promise<string> {
  const senderCid: bigint | null = await deps.io.getCurrentCid();
  if (!senderCid) {
    throw new Error('No active session');
  }

  // Before the transfer record exists, and long before anything is announced.
  //
  // The inline send path refuses a zero-byte File -- `send-operations` gates on
  // `size > 0` and otherwise throws "requires ... a non-empty browser File
  // object". That throw landed AFTER `announceTransfer`, so the recipient had an
  // offer for bytes that would never arrive: a bubble they could neither accept
  // nor decline, while the sender's transfer sat on 'pending' until its TTL.
  //
  // Refused here with a reason the user can act on. An empty file is a
  // reasonable thing to want to send, and supporting it means confirming the
  // service accepts an empty ByteContents payload -- which is a backend question,
  // not one this guard should answer by guessing.
  if (file.size === 0) {
    throw new Error(
      `"${file.name}" is empty. Files with no contents cannot be sent; ` +
        `add some content and try again.`
    );
  }

  // The ceiling, while the dialog is still open to say so: the send itself runs
  // behind the bubble and would only be able to fail there.
  const tooLarge: string | null = browserSendRefusal(file, await deps.agentStagesUploads(), false);
  if (tooLarge !== null) throw new Error(tooLarge);

  // No size check here beyond the browser ceiling (send-transfer-request): the
  // per-peer "Maximum file size" is what THIS account accepts, applied on accept.
  // Applied here too, it capped every send at the receiving default.

  // A peer known to be offline is not waited for: the send is held at once.
  const peerOnline: boolean | null = deps.queue.peerOnlineStatus(BigInt(recipientCid));
  const channelOpened: boolean = peerOnline === false ? false : await openChannelBeforeSending(deps, recipientCid);
  // A preview, not a condition of sending: a picture this browser cannot draw (HEIC in Chrome,
  // a damaged JPEG) is offered without one and its bubble keeps the file icon.
  const thumbnail: string | undefined = file.type.startsWith('image/')
    ? await deps.io.generateThumbnail(file).catch((e: unknown): undefined => {
      debugLog('transfer-lifecycle', `no thumbnail for ${file.name}; sending without one`, e);
      return undefined;
    })
    : undefined;

  const transferId: `${string}-${string}-${string}-${string}-${string}` = crypto.randomUUID();
  eventEmitter.emit(FILE_TRANSFER_EVENTS.FILE_SENT, { transfer: { id: transferId, senderCid, recipientCid: BigInt(recipientCid) }, file });
  const expiresAt: number = Date.now() + FILE_TRANSFER_REQUEST_TTL_MS;

  const transfer: FileTransfer = {
    id: transferId,
    fileName: file.name,
    fileSize: file.size,
    fileType: file.type,
    thumbnail,
    state: 'pending',
    progress: 0,
    senderCid: senderCid.toString(),
    recipientCid,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    expiresAt,
    isIncoming: false,
    // One id for the offer however often it is announced (transfer-announcement.ts).
    offerMessageId: crypto.randomUUID(),
  };

  if (shouldQueue(peerOnline, channelOpened)) return holdUntilOnline(deps, transfer, file);

  // The bubble appears now, 'preparing', and the dialog is done: staging a large
  // file and offering it happen behind it, visibly (deliver-send.ts). The bytes go
  // over the protocol's FileTransfer -- the one route whose result the recipient
  // can open.
  transfer.state = 'preparing';
  deps.state.setTransfer(transfer);
  await deps.saveTransfer(transfer);
  showOwnOffer(buildTransferAnnouncement(transfer), transfer);
  deps.emitStateChange(transfer);
  // Best effort beside the send: not keeping the bytes only means a reload cannot resend them.
  keepForResume(deps, transfer, file).catch((e: unknown): void => debugLog('transfer-lifecycle', 'could not keep a send for a reload', e));
  void deliverSend(deps, transfer, file);

  return transferId;
}

export async function cancelTransfer(deps: LifecycleDeps, transferId: string): Promise<void> {
  const transfer: FileTransfer | undefined = deps.state.getTransfer(transferId);
  if (!transfer) {
    throw new Error('Transfer not found');
  }

  // The exported set, not a third hand-rolled copy of it. This one omitted
  // 'error', 'declined' and 'expired', so a cancel could rewrite a transfer
  // that had already failed, been refused, or timed out -- turning a real
  // outcome into "cancelled" in the history.
  if (isTerminalTransferState(transfer.state)) return;

  // A held send was never offered, so there is nobody to tell; drop its File.
  // One still staging was not offered either: stop the upload to the agent.
  if (transfer.state === 'queued') {
    await deps.queue.release(transferId);
  } else if (transfer.state === 'preparing') {
    stopStaging(transferId);
  } else {
    await deps.io.executeIntent({
      type: 'send-cancel',
      transferId,
      targetCid: transfer.recipientCid,
      reason: 'Sender cancelled transfer',
      failed: false,
    });
  }
  if (!isStillOpen(deps.state, transfer)) return;

  transfer.state = 'cancelled';
  transfer.updatedAt = Date.now();
  await deps.saveTransfer(transfer);
  deps.emitStateChange(transfer);
  eventEmitter.emit(FILE_TRANSFER_EVENTS.CANCELLED, transfer);
}

export async function acceptTransfer(deps: LifecycleDeps, transferId: string): Promise<void> {
  const transfer: FileTransfer | undefined = deps.state.getTransfer(transferId);
  if (!transfer) throw new Error('Transfer not found');
  if (!transfer.isIncoming) throw new Error('Cannot accept outgoing transfer');
  if (transfer.state !== 'pending') {
    throw new Error(`Cannot accept transfer in state: ${transfer.state}`);
  }

  // Labelled "Max file size to accept" but read only on the SEND path above,
  // so lowering the slider never limited what arrived. Size is on the offer.
  const settings: FileTransferSettings = deps.state.getSettings(scopedSettingsKey(transfer.senderCid));
  if (transfer.fileSize > settings.maxFileSize) {
    throw new Error(
      `File size ${formatBytes(transfer.fileSize)} exceeds your limit of ` +
        `${formatBytes(settings.maxFileSize)}. Raise it in Chat Settings to accept this file.`
    );
  }

  const tickRequestId: unknown = await deps.io.executeIntent({
    type: 'send-response',
    transferId,
    targetCid: transfer.senderCid,
    accepted: true,
  });
  if (!isStillOpen(deps.state, transfer)) return;

  // The agent keeps receiving across a reload and names the stream by this id.
  if (typeof tickRequestId === 'string') transfer.tickRequestId = tickRequestId;
  transfer.state = 'transferring';
  transfer.updatedAt = Date.now();
  await deps.saveTransfer(transfer);
  deps.emitStateChange(transfer);
}

export async function declineTransfer(
  deps: LifecycleDeps,
  transferId: string,
  reason?: string
): Promise<void> {
  const transfer: FileTransfer | undefined = deps.state.getTransfer(transferId);
  if (!transfer) {
    throw new Error('Transfer not found');
  }

  if (!transfer.isIncoming) {
    throw new Error('Cannot decline outgoing transfer');
  }

  await deps.io.executeIntent({
    type: 'send-response',
    transferId,
    targetCid: transfer.senderCid,
    accepted: false,
    reason,
  });

  transfer.state = 'declined';
  transfer.updatedAt = Date.now();
  await deps.saveTransfer(transfer);
  deps.emitStateChange(transfer);
}

// Re-exported so existing importers keep working; see transfer-format.
export { getMimeType, formatBytes };

export { sendFileWithNativePicker } from './send-with-native-picker';
