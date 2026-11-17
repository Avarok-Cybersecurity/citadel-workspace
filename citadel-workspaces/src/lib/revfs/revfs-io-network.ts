/**
 * RE-VFS Network I/O
 *
 * Backend file operations wired to WASM client / Citadel protocol.
 * Handles SendFile, DownloadFile, DeleteVirtualFile via event emitter.
 */

import { fileTransferService } from '@/lib/file-transfer/service';
import type { RevfsIntentResult } from '@/types/revfs-intents';
import { eventEmitter } from '../event-emitter';
import { debugLog } from '@/lib/debug-config';
import { TIMEOUT } from '../timeout-constants';

/** Timeout for backend file operations (30 seconds) */
export const BACKEND_TIMEOUT_MS: number = TIMEOUT.FILE_SEND_MS;

export interface NetworkIODeps {
  sendInternalServiceRequest: (request: unknown) => Promise<void>;
}

/**
 * Send a file via the Citadel protocol.
 * - If peerCid is bigint: file is stored in peer's virtual file system (P2P)
 * - If peerCid is null: file is stored on server (server storage)
 */
export async function backendSendFile(
  deps: NetworkIODeps,
  cid: bigint,
  peerCid: bigint | null,
  fileName: string,
  content: Uint8Array,
  virtualDir: string,
): Promise<RevfsIntentResult> {
  const requestId: string = crypto.randomUUID();
  const isServerStorage: boolean = peerCid === null;
  debugLog('RevfsIO', `backendSendFile: name=${fileName} bytes=${content.byteLength} virtualDir=${virtualDir} requestId=${requestId} scope=${isServerStorage ? 'server' : 'peer'}`);

  // Tell the chat-transfer plane this stream is not one of its own.
  //
  // The internal service stamps a revfs push's ticks with the browser's own
  // SendFile request_id, and the chat plane's tick correlator falls back to the
  // oldest live transfer to the same peer when it cannot match one. So an
  // unregistered revfs push could complete or fail an unrelated pending chat
  // transfer -- marking it "Sent successfully" while nothing of the sort had
  // happened. The staging upload was registered when that filter was added;
  // this caller, the general revfs push, was the twin that was missed.
  //
  // Registered BEFORE the send: the WebSocket is ordered, so no tick for this
  // stream can precede it.
  fileTransferService.markForeignOutgoingStream(requestId);

  // ByteContents.data is a Rust Vec<u8>, which serialises as a number array —
  // the same shape the working file-transfer upload sends.
  const data: number[] = Array.from(content);

  const request: { SendFile: { request_id: string; source: { ByteContents: { file_name: string; data: number[]; }; }; cid: bigint; peer_cid: bigint | null; chunk_size: null; transfer_type: { RemoteEncryptedVirtualFilesystem: { virtual_path: string; security_level: string; }; }; }; } = {
    SendFile: {
      request_id: requestId,
      // The externally-tagged FileSource enum. This used to be a bare string
      // holding a tree directory path, which the WASM client's strict
      // deserializer rejected — so the request never left the browser and the
      // internal service never logged a thing.
      source: { ByteContents: { file_name: fileName, data } },
      cid,
      peer_cid: peerCid,
      chunk_size: null,
      // RemoteEncryptedVirtualFilesystem, not FileTransfer: this is what creates
      // the virtual_path key that DownloadFile and DeleteVirtualFile address.
      // With 'FileTransfer' the bytes would have gone somewhere unaddressable
      // even once the source was right.
      transfer_type: {
        RemoteEncryptedVirtualFilesystem: {
          virtual_path: virtualDir,
          security_level: 'Standard',
        },
      },
    },
  };

  return new Promise((resolve) => {
    // Idle timeout, re-armed on every event for THIS request: a large
    // transfer that is still ticking must not be declared dead at a fixed
    // 30s, while a transfer nobody is answering still fails honestly.
    let timeout: ReturnType<typeof setTimeout>;
    const armTimeout = (): void => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        eventEmitter.off('websocket-message', handleMessage);
        debugLog('RevfsIO', 'backendSendFile timed out');
        resolve({ type: 'backend-send-file', success: false, reason: `Nothing answered for ${BACKEND_TIMEOUT_MS / 1000} s.` });
      }, BACKEND_TIMEOUT_MS);
    };

    const settle = (result: RevfsIntentResult): void => {
      clearTimeout(timeout);
      eventEmitter.off('websocket-message', handleMessage);
      resolve(result);
    };

    const handleMessage = (message: unknown): void => {
      const msg: Record<string, unknown> = message as Record<string, unknown>;

      // SendFileRequestSuccess is emitted the moment the internal service
      // QUEUES the SendObject — before the receiving side has accepted
      // anything. Resolving on it reported success for peer-scoped uploads
      // that nothing ever accepted: the uploader placed the node and synced
      // the tree op, so both peers listed a "downloadable" file whose bytes
      // existed nowhere. It is only a dispatch ack; keep waiting for the
      // Sender-side tick stream, which the internal service now stamps with
      // this request_id (kernel/revfs_correlation.rs).
      const dispatched: { request_id?: string; } | undefined = msg.SendFileRequestSuccess as { request_id?: string } | undefined;
      if (dispatched?.request_id === requestId) {
        debugLog('RevfsIO', 'backendSendFile dispatched, awaiting transfer completion');
        armTimeout();
        return;
      }

      // TransferComplete is the Sender-side terminal tick: every chunk was
      // streamed and acknowledged by the node that now stores the bytes. The
      // receiver only acks the file header after ACCEPTING the transfer, so
      // this cannot fire for a push nobody accepted. Unit variants serialise
      // as the bare string; Fail is a newtype carrying the message.
      const tick: { request_id?: string; status?: Record<string, unknown> | string; } | undefined = msg.FileTransferTickNotification as {
        request_id?: string;
        status?: Record<string, unknown> | string;
      } | undefined;
      if (tick && tick.request_id === requestId) {
        const status: string | Record<string, unknown> | undefined = tick.status;
        if (status === 'TransferComplete') {
          debugLog('RevfsIO', 'backendSendFile transfer complete');
          settle({ type: 'backend-send-file', success: true, virtualDir });
          return;
        }
        if (status === 'Fail' || (status !== null && typeof status === 'object' && 'Fail' in status)) {
          debugLog('RevfsIO', 'backendSendFile transfer failed');
          const said: unknown = typeof status === 'object' ? status.Fail : undefined;
          settle({ type: 'backend-send-file', success: false, reason: typeof said === 'string' && said !== '' ? said : 'The transfer failed.' });
          return;
        }
        // Progress (TransferBeginning / TransferTick): still alive.
        armTimeout();
        return;
      }

      const failure: { request_id?: string; message?: string; } | undefined = msg.SendFileRequestFailure as { request_id?: string; message?: string } | undefined;
      if (failure?.request_id === requestId) {
        debugLog('RevfsIO', 'backendSendFile failed:', failure.message);
        settle({ type: 'backend-send-file', success: false, reason: typeof failure.message === 'string' && failure.message !== '' ? failure.message : 'The agent refused the upload without a reason.' });
      }
    };

    armTimeout();
    eventEmitter.on('websocket-message', handleMessage);

    deps.sendInternalServiceRequest(request).catch(error => {
      clearTimeout(timeout);
      eventEmitter.off('websocket-message', handleMessage);
      debugLog('RevfsIO', 'backendSendFile request error:', error);
      resolve({ type: 'backend-send-file', success: false, reason: error instanceof Error ? error.message : String(error) });
    });
  });
}

/**
 * Delete a file from the virtual filesystem via the Citadel protocol.
 */
export async function backendDeleteFile(
  deps: NetworkIODeps,
  cid: bigint,
  peerCid: bigint | null,
  virtualDir: string,
): Promise<RevfsIntentResult> {
  const requestId: string = crypto.randomUUID();
  const isServerStorage: boolean = peerCid === null;
  debugLog('RevfsIO', `backendDeleteFile: virtualDir=${virtualDir} requestId=${requestId} scope=${isServerStorage ? 'server' : 'peer'}`);

  const request: { DeleteVirtualFile: { request_id: string; virtual_directory: string; cid: bigint; peer_cid: bigint | null; }; } = {
    DeleteVirtualFile: {
      request_id: requestId,
      virtual_directory: virtualDir,
      cid,
      peer_cid: peerCid,
    },
  };

  return new Promise((resolve) => {
    const timeout: NodeJS.Timeout = setTimeout((): void => {
      eventEmitter.off('websocket-message', handleMessage);
      debugLog('RevfsIO', 'backendDeleteFile timed out');
      resolve({ type: 'backend-delete-file', success: false });
    }, BACKEND_TIMEOUT_MS);

    const handleMessage = (message: unknown): void => {
      const msg: Record<string, unknown> = message as Record<string, unknown>;

      const success: { request_id?: string; } | undefined = msg.DeleteVirtualFileSuccess as { request_id?: string } | undefined;
      if (success?.request_id === requestId) {
        clearTimeout(timeout);
        eventEmitter.off('websocket-message', handleMessage);
        debugLog('RevfsIO', 'backendDeleteFile success');
        resolve({ type: 'backend-delete-file', success: true });
      }

      const failure: { request_id?: string; message?: string; } | undefined = msg.DeleteVirtualFileFailure as { request_id?: string; message?: string } | undefined;
      if (failure?.request_id === requestId) {
        clearTimeout(timeout);
        eventEmitter.off('websocket-message', handleMessage);
        debugLog('RevfsIO', 'backendDeleteFile failed:', failure.message);
        resolve({ type: 'backend-delete-file', success: false });
      }
    };

    eventEmitter.on('websocket-message', handleMessage);

    deps.sendInternalServiceRequest(request).catch(error => {
      clearTimeout(timeout);
      eventEmitter.off('websocket-message', handleMessage);
      debugLog('RevfsIO', 'backendDeleteFile request error:', error);
      resolve({ type: 'backend-delete-file', success: false });
    });
  });
}
