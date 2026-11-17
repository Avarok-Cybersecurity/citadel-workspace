/** Receive Operations - RespondFileTransfer, DownloadFile, subscription factories. */

import { eventEmitter } from '../event-emitter';
import { failOnSocketLoss } from '../websocket/request-response';
import { websocketService } from '../websocket-service';
import type {
  RespondTransferParams, DownloadFileParams, TransferRequestEvent,
  TransferProgressEvent, TransferCompleteEvent, TransferStatusEvent,
} from './io-router-types';
import { debugLog } from '@/lib/debug-config';
import { TIMEOUT } from '../timeout-constants';
import type {
  FileTransferRequestNotification, FileTransferStatusNotification,
  FileTransferTickNotification,
} from './protocol-types';
import { parseTickNotification, type TickCorrelation } from './tick-events';
import type { ParsedTick } from '@/lib/file-transfer/tick-events';
import type { VirtualObjectMetadata } from '@avarok/citadel-protocol-types';

/**
 * Send RespondFileTransfer and return the request UUID it was sent under.
 *
 * The return value matters: when we ACCEPT a transfer, the internal service
 * spawns the reception tick updater with exactly this request_id, so it is
 * the one stable key that ties the id-less ticks and completes that follow
 * back to the transfer being accepted. The router records it in the
 * correlation maps (see tick-events.ts).
 */
export async function executeRespondToTransfer(params: RespondTransferParams): Promise<string> {
  const requestId: `${string}-${string}-${string}-${string}-${string}` = crypto.randomUUID();
  const request: { RespondFileTransfer: { request_id: `${string}-${string}-${string}-${string}-${string}`; cid: bigint; peer_cid: bigint; object_id: bigint; accept: boolean; download_location: string | null; }; } = {
    RespondFileTransfer: {
      request_id: requestId,
      cid: params.cid,
      peer_cid: params.peerCid,
      object_id: BigInt(params.protocolId),
      accept: params.accept,
      download_location: params.downloadLocation ?? null,
    },
  };

  debugLog('receive-operations', 'Sending RespondFileTransfer', {
    requestId,
    cid: params.cid.toString(),
    peerCid: params.peerCid.toString(),
    objectId: params.protocolId,
    accept: params.accept,
  });

  await websocketService.sendRequest(request);
  return requestId;
}

export async function executeDownloadFile(params: DownloadFileParams): Promise<void> {
  const requestId: `${string}-${string}-${string}-${string}-${string}` = crypto.randomUUID();
  const request: { DownloadFile: { request_id: `${string}-${string}-${string}-${string}-${string}`; virtual_directory: string; cid: bigint; peer_cid: bigint | null; security_level: string | null; delete_on_pull: boolean; }; } = {
    DownloadFile: {
      request_id: requestId,
      virtual_directory: params.virtualDirectory,
      cid: params.cid,
      peer_cid: params.peerCid,
      security_level: params.securityLevel ?? null,
      delete_on_pull: params.deleteOnPull ?? false,
    },
  };

  debugLog('receive-operations', 'Sending DownloadFile', {
    requestId,
    virtualDirectory: params.virtualDirectory,
    cid: params.cid.toString(),
    peerCid: params.peerCid?.toString(),
  });

  return failOnSocketLoss('ReceiveFile', new Promise((resolve, reject) => {
    const timeout: NodeJS.Timeout = setTimeout((): void => {
      eventEmitter.off('websocket-message', handleMessage);
      reject(new Error('DownloadFile request timed out'));
    }, TIMEOUT.FILE_DOWNLOAD_MS);

    const handleMessage = (message: Record<string, unknown>): void => {
      const success: { request_id?: string; } | undefined = message.DownloadFileSuccess as { request_id?: string } | undefined;
      const failure: { request_id?: string; message?: string; } | undefined = message.DownloadFileFailure as
        | { request_id?: string; message?: string }
        | undefined;

      if (success?.request_id === requestId) {
        clearTimeout(timeout);
        eventEmitter.off('websocket-message', handleMessage);
        debugLog('receive-operations', 'DownloadFile success');
        resolve();
      }

      if (failure?.request_id === requestId) {
        clearTimeout(timeout);
        eventEmitter.off('websocket-message', handleMessage);
        const errorMsg: string = failure.message || 'DownloadFile failed';
        debugLog('receive-operations', 'DownloadFile failed', errorMsg);
        reject(new Error(errorMsg));
      }
    };

    eventEmitter.on('websocket-message', handleMessage);

    websocketService.sendRequest(request).catch(error => {
      clearTimeout(timeout);
      eventEmitter.off('websocket-message', handleMessage);
      reject(error);
    });
  }));
}

export function createTransferRequestHandler(
  callback: (event: TransferRequestEvent) => void
): (message: Record<string, unknown>) => void {
  return (message: Record<string, unknown>) => {
    const notification: FileTransferRequestNotification | undefined = message.FileTransferRequestNotification as
      | FileTransferRequestNotification
      | undefined;
    if (!notification) return;

    const metadata: VirtualObjectMetadata = notification.metadata;
    // RE-VFS pushes arrive through the same notification; they are handled by
    // the revfs service and must not enter the chat-transfer correlator, where
    // their name/size could join against an unrelated chat announcement.
    if (metadata.transfer_type !== 'FileTransfer') return;

    callback({
      cid: notification.cid,
      peerCid: notification.peer_cid,
      protocolId: metadata.object_id.toString(),
      fileName: metadata.name,
      // The wire calls the byte count `plaintext_length`; there is no
      // `file_size` field. Reading one here returned undefined -> NaN, which
      // made every offer-correlation join fail on size.
      fileSize: Number(metadata.plaintext_length),
      // VirtualObjectMetadata carries no MIME type; the announcement message
      // is the source of the display type.
      fileType: undefined,
      thumbnail: undefined, expiresAt: undefined,
    });
  };
}

export function createProgressHandler(
  callback: (event: TransferProgressEvent) => void,
  correlation: TickCorrelation
): (message: Record<string, unknown>) => void {
  return (message: Record<string, unknown>) => {
    const notification: FileTransferTickNotification | undefined = message.FileTransferTickNotification as
      | FileTransferTickNotification
      | undefined;
    if (!notification) return;

    const parsed: ParsedTick = parseTickNotification(notification, correlation);
    if (parsed?.kind !== 'progress') return;

    callback({
      transferId: parsed.transferId,
      cid: parsed.cid,
      peerCid: parsed.peerCid,
      direction: parsed.direction,
      bytesTransferred: parsed.bytesTransferred,
      totalBytes: parsed.totalBytes,
      percentage: parsed.percentage,
      status: parsed.status,
      ...(parsed.downloadPath !== undefined ? { downloadPath: parsed.downloadPath } : {}),
    });
  };
}

export function createCompleteHandler(
  callback: (event: TransferCompleteEvent) => void,
  correlation: TickCorrelation
): (message: Record<string, unknown>) => void {
  return (message: Record<string, unknown>) => {
    const notification: FileTransferTickNotification | undefined = message.FileTransferTickNotification as
      | FileTransferTickNotification
      | undefined;
    if (!notification) return;

    const parsed: ParsedTick = parseTickNotification(notification, correlation);
    if (parsed?.kind !== 'complete') return;

    callback({
      transferId: parsed.transferId,
      cid: parsed.cid,
      peerCid: parsed.peerCid,
      direction: parsed.direction,
      success: parsed.success,
      downloadPath: parsed.downloadPath,
      errorMessage: parsed.errorMessage,
    });
  };
}

export function createStatusChangeHandler(
  callback: (event: TransferStatusEvent) => void,
  correlation: TickCorrelation
): (message: Record<string, unknown>) => void {
  return (message: Record<string, unknown>) => {
    // A send the agent accepted and the SDK then refused: the same request_id answered twice,
    // Success then Failure. executeSendFile resolved on the first answer, so this is the only
    // place the refusal can land; only a request the router filed after acceptance is joined.
    const lateRefusal: { cid: bigint; message: string; request_id?: string } | undefined =
      message.SendFileRequestFailure as { cid: bigint; message: string; request_id?: string } | undefined;
    if (lateRefusal?.request_id) {
      const refusedTransfer: string | undefined = correlation.requestIdToTransferId.get(lateRefusal.request_id);
      if (refusedTransfer) {
        correlation.requestIdToTransferId.delete(lateRefusal.request_id);
        callback({ protocolId: '', transferId: refusedTransfer, cid: lateRefusal.cid, success: false, accepted: false, message: lateRefusal.message });
      }
      return;
    }

    const notification: FileTransferStatusNotification | undefined = message.FileTransferStatusNotification as
      | FileTransferStatusNotification
      | undefined;
    if (!notification) return;

    const objectId: string = notification.object_id.toString();
    const transferId: string | undefined = correlation.objectIdToTransferId.get(objectId);
    // The status notification is the one recipient-side message that carries
    // BOTH the object_id and the accept request's request_id, so it is a
    // second chance to join the tick stream to its transfer (belt to
    // ReceptionBeginning's braces).
    if (transferId && notification.request_id) {
      correlation.requestIdToTransferId.set(notification.request_id, transferId);
    }

    callback({
      protocolId: objectId,
      transferId,
      cid: notification.cid,
      success: notification.success,
      accepted: notification.response && notification.success,
      message: notification.message ?? undefined,
    });
  };
}
