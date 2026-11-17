/**
 * Send Operations
 *
 * Outbound file transfer operations for the real protocol I/O router:
 * - SendFile: Initiate file transfer via InternalServiceRequest
 * - CancelTransfer: Clean up local state (protocol cancels implicitly)
 */

import { eventEmitter } from '../event-emitter';
import { failOnSocketLoss } from '../websocket/request-response';
import { formatBytes } from '../format-bytes';
import { websocketService } from '../websocket-service';
import type { FileSource, SendFileParams, SendFileResult, CancelTransferParams } from './io-router-types';
import { debugLog } from '@/lib/debug-config';
import { TIMEOUT } from '../timeout-constants';

/**
 * ONE cap governs every inline `FileSource.ByteContents` payload:
 * `MAX_BYTE_CONTENTS_BYTES` in server-upload.ts, which mirrors the internal
 * service's own limit (requests/file/upload.rs, 16 MiB — the authority).
 *
 * This module used to carry its own second cap of 2 MiB for the same
 * mechanism. Two limits for one wire format meant the p2p path refused files
 * the "async" path shipped every day, and a 2–16 MiB p2p send died here AFTER
 * its offer was already announced to the recipient. The memory cost of an
 * inline payload (`Array.from` boxes every byte, ~4-8x on V8, and the frame
 * serialisation doubles it again) is the same on both paths and is bounded by
 * the same 16 MiB the staging upload already demonstrates in production;
 * files above it must use the native PickFile flow, which streams from disk.
 *
 * Re-exported under the old name for the existing importer outside this
 * module (components/p2p/useFileTransfer.ts).
 */
export { MAX_BYTE_CONTENTS_BYTES as MAX_BYTE_CONTENTS_SIZE_BYTES } from './server-upload';
import { MAX_BYTE_CONTENTS_BYTES } from './server-upload';

/**
 * Refuse a browser File that exceeds the inline ByteContents cap.
 *
 * Exported so the send-request executor can apply it BEFORE the offer is
 * announced to the recipient (see send-transfer-request.ts) — throwing only
 * here, after the announcement, is what left recipients with phantom offers.
 */
export function assertInlineSendable(file: Pick<File, 'name' | 'size'>): void {
  if (file.size > MAX_BYTE_CONTENTS_BYTES) {
    throw new Error(
      `File "${file.name}" is ${formatBytes(file.size)}; ` +
        `inline browser uploads are capped at ${formatBytes(MAX_BYTE_CONTENTS_BYTES)}. ` +
        `Use the native file picker for larger files.`
    );
  }
}


interface SendFileSuccessResponse {
  cid: bigint;
  request_id?: string;
}

interface SendFileFailureResponse {
  cid: bigint;
  message: string;
  request_id?: string;
}

/**
 * Send a file via the real Citadel protocol (SendFile InternalServiceRequest).
 */
export async function executeSendFile(
  params: SendFileParams
): Promise<SendFileResult> {
  let source: FileSource;

  if (typeof params.source === 'string') {
    source = { Path: params.source };
  } else if (params.pickFileRequestId) {
    source = { PickFileRef: { pick_file_request_id: params.pickFileRequestId } };
  } else if (params.stagedUploadId !== undefined) {
    // Staged on the agent in acknowledged chunks before the offer (send-transfer-request).
    source = { StagedUpload: { upload_id: params.stagedUploadId } };
  } else if (params.source instanceof File && params.source.size > 0) {
    // An agent that does not stage takes the file inline, in one frame. Size
    // guard first: refuse payloads that would OOM the tab when converted to a
    // boxed-number JS array, before arrayBuffer() allocates anything.
    assertInlineSendable(params.source);

    // Read browser File as bytes and send as ByteContents
    const buffer: ArrayBuffer = await params.source.arrayBuffer();
    source = {
      ByteContents: {
        file_name: params.source.name,
        data: Array.from(new Uint8Array(buffer)),
      },
    };
    debugLog('send-operations', 'Converted browser File to ByteContents', {
      fileName: params.source.name,
      size: params.source.size,
    });
  } else {
    throw new Error(
      'RealProtocolIORouter requires file path (string), pickFileRequestId, or a non-empty browser File object.'
    );
  }

  const requestId: `${string}-${string}-${string}-${string}-${string}` = crypto.randomUUID();
  const request: { SendFile: { request_id: `${string}-${string}-${string}-${string}-${string}`; source: FileSource; cid: bigint; peer_cid: bigint | null; chunk_size: number | null; transfer_type: string; }; } = {
    SendFile: {
      request_id: requestId,
      source,
      cid: params.cid,
      peer_cid: params.peerCid,
      chunk_size: params.chunkSize ?? null,
      transfer_type: 'FileTransfer',
    },
  };

  // Never log `source` verbatim: for a browser `File` it carries the entire
  // file as a `data: number[]`, which would dump (potentially secret) file
  // contents into dev logs and allocate/format a huge array on every inline
  // transfer. Log a redacted summary instead.
  const sourceSummary: Exclude<FileSource, { ByteContents: unknown }> | { kind: "ByteContents"; fileName: string; byteLength: number; } =
    'ByteContents' in source
      ? {
          kind: 'ByteContents' as const,
          fileName: source.ByteContents.file_name,
          byteLength: source.ByteContents.data.length,
        }
      : source;
  debugLog('send-operations', 'Sending SendFile request', {
    requestId,
    source: sourceSummary,
    cid: params.cid.toString(),
    peerCid: params.peerCid?.toString(),
    transferId: params.transferId,
  });

  return failOnSocketLoss('SendFile', new Promise((resolve, reject) => {
    const timeout: NodeJS.Timeout = setTimeout((): void => {
      eventEmitter.off('websocket-message', handleMessage);
      reject(new Error('SendFile request timed out'));
    }, TIMEOUT.FILE_SEND_MS);

    const handleMessage = (message: Record<string, unknown>): void => {
      const success: SendFileSuccessResponse | undefined = message.SendFileRequestSuccess as SendFileSuccessResponse | undefined;
      const failure: SendFileFailureResponse | undefined = message.SendFileRequestFailure as SendFileFailureResponse | undefined;

      if (success?.request_id === requestId) {
        clearTimeout(timeout);
        eventEmitter.off('websocket-message', handleMessage);
        debugLog('send-operations', 'SendFile accepted');
        resolve({
          protocolId: params.transferId,
          transferId: params.transferId,
          requestId,
        });
      }

      if (failure?.request_id === requestId) {
        clearTimeout(timeout);
        eventEmitter.off('websocket-message', handleMessage);
        const errorMsg: string = failure.message || 'SendFile failed';
        debugLog('send-operations', 'SendFile failed', errorMsg);
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

/**
 * Cancel a transfer - cleans up local correlation maps.
 * The real protocol cancels implicitly when either side disconnects.
 */
export function executeCancelTransfer(
  params: CancelTransferParams,
  transferIdToObjectId: Map<string, string>,
  objectIdToTransferId: Map<string, string>
): void {
  debugLog('send-operations', 'cancelTransfer called', {
    transferId: params.transferId,
    targetCid: params.targetCid.toString(),
    reason: params.reason,
  });

  const objectId: string | undefined = transferIdToObjectId.get(params.transferId);
  if (objectId) {
    objectIdToTransferId.delete(objectId);
    transferIdToObjectId.delete(params.transferId);
  }
}

