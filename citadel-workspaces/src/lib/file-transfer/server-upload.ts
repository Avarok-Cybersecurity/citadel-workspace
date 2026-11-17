/**
 * File Transfer - SendFile acknowledgement and the inline-payload cap.
 *
 * The browser holds a `File` — bytes in memory, with no filesystem path the
 * internal service could open. `FileSource::ByteContents` carries the payload
 * inline and the service materialises it to a temp file on the far side; the
 * native-picker flow uses `FileSource::Path` / `PickFileRef` instead.
 *
 * This module once also staged "standard" sends as a RE-VFS push for the
 * recipient to pull. A RE-VFS object is retrievable only by its pusher, so
 * that pull could never succeed; both modes now use the protocol transfer.
 */

import { eventEmitter } from '../event-emitter';
import { failOnSocketLoss } from '../websocket/request-response';
import { debugLog } from '@/lib/debug-config';
import { TIMEOUT } from '../timeout-constants';

/**
 * Largest inline payload the internal service will accept for one
 * `FileSource::ByteContents` request.
 *
 * Mirrors `MAX_BYTE_CONTENTS_BYTES` in
 * `citadel-internal-service/src/kernel/requests/file/upload.rs`. The service is
 * the authority — this constant exists so an oversized file fails here, with a
 * message naming the limit and the alternative, instead of being serialised into
 * a WebSocket frame only to be rejected on arrival.
 *
 * Keep the two in lockstep. Files above this must use the native PickFile flow,
 * which streams from disk and bypasses both this cap and the JSON expansion.
 */
export const MAX_BYTE_CONTENTS_BYTES: number = 16 * 1024 * 1024; // 16 MiB

/**
 * Send a `SendFile` request via `send` and resolve once the internal service
 * acknowledges it, or reject with the service's own failure message.
 *
 * Shared by the SendFile paths that need an acknowledgement (native-picker send) so
 * the correlation-by-request_id, the listener teardown and the timeout are
 * defined once rather than reimplemented per call site.
 *
 * `send` runs INSIDE this promise, after the listener is registered, so a send
 * failure settles the same promise the caller awaits. The call sites used to
 * create this promise first and `await sendMessage(...)` beside it; when the
 * send threw, the orphaned promise kept its listener for the full timeout and
 * then rejected with nobody listening — an unhandled rejection 30s after the
 * caller had already reported the real error. The other request/response sites
 * (send-operations.ts, receive-operations.ts) already wire the send's .catch
 * into their promise; this adopts the same shape.
 */
export function awaitSendFileAck(requestId: string, send: () => Promise<void>): Promise<void> {
  return failOnSocketLoss('ServerUpload', new Promise<void>((resolve, reject) => {
    const timeout: NodeJS.Timeout = setTimeout((): void => {
      eventEmitter.off('websocket-message', handleMessage);
      reject(new Error('SendFile request timed out'));
    }, TIMEOUT.FILE_SEND_MS);

    const settle = (fn: () => void): void => {
      clearTimeout(timeout);
      eventEmitter.off('websocket-message', handleMessage);
      fn();
    };

    const handleMessage = (message: unknown): void => {
      const msg: Record<string, unknown> = message as Record<string, unknown>;

      const success: { request_id?: string; } | undefined = msg.SendFileRequestSuccess as { request_id?: string } | undefined;
      if (success?.request_id === requestId) {
        settle(() => {
          debugLog('FileTransferIO', 'SendFile accepted by protocol', { requestId });
          resolve();
        });
        return;
      }

      const failure: { request_id?: string; message?: string; } | undefined = msg.SendFileRequestFailure as
        | { request_id?: string; message?: string }
        | undefined;
      if (failure?.request_id === requestId) {
        settle(() => {
          const errorMsg: string = failure.message || 'SendFile failed';
          debugLog('FileTransferIO', 'SendFile failed', { requestId, errorMsg });
          reject(new Error(errorMsg));
        });
      }
    };

    eventEmitter.on('websocket-message', handleMessage);

    send().catch((error: unknown): void => {
      settle(() => reject(error instanceof Error ? error : new Error(String(error))));
    });
  }));
}
