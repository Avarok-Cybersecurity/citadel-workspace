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
import { readPushTick, SessionPushes, type PushTickReading } from './push-watch';
import { emitPushPhase } from './push-phase-events';

/** Timeout for backend file operations (30 seconds) */
export const BACKEND_TIMEOUT_MS: number = TIMEOUT.FILE_SEND_MS;

/** Why a push failed when the agent sent it but the receiver never accepted the file. */
export function notAcceptedReason(seconds: number): string {
  return `The other side did not accept the file within ${seconds} s.`;
}

/** This page's pushes in flight, per session: a push begun behind another is queued (push-watch.ts). */
const sessionPushes: SessionPushes = new SessionPushes();

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
  pushId: string,
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

  // ByteContents.data is a Rust Vec<u8>: a Uint8Array here, written as the agent's
  // number array by the WASM client — the same shape the file-transfer upload sends.
  const data: Uint8Array = content;

  const request: { SendFile: { request_id: string; source: { ByteContents: { file_name: string; data: Uint8Array; }; }; cid: bigint; peer_cid: bigint | null; chunk_size: null; transfer_type: { RemoteEncryptedVirtualFilesystem: { virtual_path: string; security_level: string; }; }; }; } = {
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
    // Two clocks, never both running. From the request until the receiver accepts the file
    // (TransferBeginning) the page bounds the wait itself: the SDK puts no deadline on accepting
    // a file header. From then on the SDK bounds every wait up to the first group's answer and
    // ends a stalled transfer with `Failed` (FILE_GROUP_HEADER_UNANSWERED_FAILS_WITHIN, under
    // FILE_SEND_MS), and a push queued behind an earlier one may rightly wait far longer than
    // FILE_SEND_MS; so the idle timeout starts again only at the first TransferTick, and each
    // tick re-arms it, as the last resort for a stream that stops between groups.
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let dispatched: boolean = false;
    let accepted: boolean = false;
    const armTimeout = (): void => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        eventEmitter.off('websocket-message', handleMessage);
        sessionPushes.end(cid, requestId);
        debugLog('RevfsIO', 'backendSendFile timed out');
        const seconds: number = BACKEND_TIMEOUT_MS / 1000;
        resolve({ type: 'backend-send-file', success: false, reason: dispatched && !accepted ? notAcceptedReason(seconds) : `Nothing answered for ${seconds} s.` });
      }, BACKEND_TIMEOUT_MS);
    };

    const settle = (result: RevfsIntentResult): void => {
      clearTimeout(timeout);
      eventEmitter.off('websocket-message', handleMessage);
      sessionPushes.end(cid, requestId);
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
      const ack: { request_id?: string; } | undefined = msg.SendFileRequestSuccess as { request_id?: string } | undefined;
      if (ack?.request_id === requestId) {
        debugLog('RevfsIO', 'backendSendFile dispatched, awaiting transfer completion');
        dispatched = true;
        return;
      }

      // TransferComplete is the Sender-side terminal tick: every chunk was
      // streamed and acknowledged by the node that now stores the bytes. The
      // receiver only acks the file header after ACCEPTING the transfer, so
      // this cannot fire for a push nobody accepted.
      const tick: { request_id?: string; status?: unknown; } | undefined = msg.FileTransferTickNotification as {
        request_id?: string;
        status?: unknown;
      } | undefined;
      if (tick && tick.request_id === requestId) {
        const reading: PushTickReading = readPushTick(tick.status);
        if (reading.kind === 'complete') {
          debugLog('RevfsIO', 'backendSendFile transfer complete');
          settle({ type: 'backend-send-file', success: true, virtualDir });
        } else if (reading.kind === 'failed') {
          debugLog('RevfsIO', 'backendSendFile transfer failed');
          settle({ type: 'backend-send-file', success: false, reason: reading.reason });
        } else if (reading.kind === 'begun') {
          clearTimeout(timeout);
          const queued: boolean = sessionPushes.begin(cid, requestId);
          emitPushPhase(pushId, queued ? { kind: 'waiting-for-earlier' } : { kind: 'progress', percentage: 0 });
        } else if (reading.kind === 'tick') {
          accepted = true;
          armTimeout();
          emitPushPhase(pushId, { kind: 'progress', percentage: reading.percentage });
        }
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
      debugLog('RevfsIO', 'backendSendFile request error:', error);
      settle({ type: 'backend-send-file', success: false, reason: error instanceof Error ? error.message : String(error) });
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
