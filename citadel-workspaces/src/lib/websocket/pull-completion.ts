/**
 * How a file PULL reports that it finished, in one place.
 *
 * Two routes pull staged files — the RE-VFS tree (`revfs-io-download.ts`) and
 * async file transfers (`file-transfer/server-download.ts`) — and both were
 * written against the same wrong idea of what the service sends back. RE-VFS was
 * corrected; the file-transfer copy was not, and kept every one of the original
 * mistakes:
 *
 *   - It waited on `FileTransferStatusNotification`, which the internal service
 *     emits from exactly one place: `respond_file_transfer.rs`, the accept /
 *     decline flow for STANDARD transfers. A pull auto-accepts and streams
 *     ticks, so the success branch was unreachable and every download sat until
 *     its timeout.
 *   - It read `status.response?.download_path`. `response` is a plain `bool` on
 *     the wire (`FileTransferStatusNotification` in the internal-service types),
 *     so that expression is `undefined` even when it matches — the resolved
 *     "download path" was a field that has never existed.
 *   - It correlated on `cid`, which is the SESSION's cid and matches every
 *     transfer notification the session sees. A concurrent transfer settled an
 *     unrelated pending download.
 *
 * Sharing the implementation is the point. The duplication is what let one copy
 * be fixed while the other went on being wrong, and this module exists so the
 * next protocol change lands once.
 */
import { eventEmitter } from '../event-emitter';
import { debugLog } from '@/lib/debug-config';

export interface PullOutcome {
  success: boolean;
  /** Where the bytes landed locally, learned from `ReceptionBeginning`. */
  downloadPath?: string;
  /** The service's own words, when it rejected the request outright. */
  message?: string;
}

/**
 * Resolve once the pull identified by `requestId` completes, fails, or goes
 * quiet for `timeoutMs`.
 *
 * Never rejects: the caller decides what a failed pull means. Correlation is on
 * `request_id` for every branch — the one field that identifies THIS pull.
 */
export function awaitPullCompletion(
  requestId: string,
  timeoutMs: number,
  label: string,
): Promise<PullOutcome> {
  return new Promise<PullOutcome>((resolve) => {
    let receivedPath: string | undefined;

    // Idle timeout, re-armed on every event for THIS pull — the same behaviour
    // the upload twin (revfs/revfs-io-network.ts) has, for the same reason: a
    // fixed timer declared any pull longer than `timeoutMs` dead while it was
    // still ticking and still consuming bandwidth, so the caller reported
    // "could not be downloaded" for a transfer that then completed unobserved.
    // A pull that goes QUIET for `timeoutMs` still fails honestly.
    let timeout: ReturnType<typeof setTimeout>;
    const armTimeout = (): void => {
      clearTimeout(timeout);
      timeout = setTimeout((): void => {
        eventEmitter.off('websocket-message', handleMessage);
        debugLog(label, 'pull timed out', { requestId });
        resolve({ success: false, message: 'timed out' });
      }, timeoutMs);
    };

    const settle = (outcome: PullOutcome): void => {
      clearTimeout(timeout);
      eventEmitter.off('websocket-message', handleMessage);
      resolve(outcome);
    };

    const handleMessage = (message: unknown): void => {
      const msg: Record<string, unknown> = message as Record<string, unknown>;

      const tick: { request_id?: string; status?: Record<string, unknown> | string; } | undefined =
        msg.FileTransferTickNotification as
          | { request_id?: string; status?: Record<string, unknown> | string }
          | undefined;

      if (tick && tick.request_id === requestId) {
        // Any tick for this pull is proof of life. Terminal variants settle
        // below (which clears the timer); everything else buys another window.
        armTimeout();
        const status: string | Record<string, unknown> | undefined = tick.status;

        // ReceptionBeginning carries the local path the bytes are written to.
        if (status !== null && typeof status === 'object' && 'ReceptionBeginning' in status) {
          const beginning: { path?: string; } | [string, unknown] = status.ReceptionBeginning as
            | { path?: string }
            | [string, unknown];
          receivedPath = Array.isArray(beginning) ? String(beginning[0]) : beginning?.path;
          return;
        }

        // Unit variants serialise as the bare string; a newtype carries a payload.
        const isComplete: boolean = status === 'ReceptionComplete' || status === 'TransferComplete';
        const isFailure: boolean =
          status === 'Fail' ||
          (status !== null && typeof status === 'object' && 'Fail' in status);

        if (isComplete) {
          debugLog(label, 'pull complete', { requestId, receivedPath });
          settle({ success: true, downloadPath: receivedPath });
          return;
        }
        if (isFailure) {
          debugLog(label, 'pull failed mid-transfer', { requestId });
          settle({ success: false, message: 'the transfer failed' });
        }
        return;
      }

      const failure: { request_id?: string; message?: string; } | undefined =
        msg.DownloadFileFailure as { request_id?: string; message?: string } | undefined;
      if (failure?.request_id === requestId) {
        debugLog(label, 'pull rejected', { requestId, message: failure.message });
        settle({ success: false, message: failure.message || 'DownloadFile was rejected.' });
      }
    };

    armTimeout();
    eventEmitter.on('websocket-message', handleMessage);
  });
}
