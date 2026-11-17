/**
 * A RE-VFS download must recognise the events a REVFS pull actually emits.
 *
 * It used to wait on `FileTransferStatusNotification`, which the internal
 * service emits from exactly ONE place — `respond_file_transfer.rs`, the
 * accept/decline flow for STANDARD transfers. A REVFS pull auto-accepts and
 * streams `FileTransferTickNotification` instead, so the success branch was
 * unreachable: every download timed out after 30s, resolved `success: false`,
 * and the caller — which checked only `result.type` — returned `undefined`.
 * The UI read that as "Download initiated for X".
 *
 * It also read `status.response?.download_path`, where `response` is a plain
 * bool on the wire, so even an impossible match would have yielded undefined.
 *
 * And it correlated on `status.cid === cid`, matching ANY transfer notification
 * for the session, so a concurrent standard transfer settled an unrelated
 * pending download.
 *
 * THE FIXTURE BELOW IS A CONTRACT, NOT A CONVENIENCE. Ticks addressed to the
 * browser's request_id only exist because the internal service threads it
 * through: the SDK's PullObject cannot carry a request id, so the kernel
 * registers it per-session in `kernel/revfs_correlation.rs` (written by
 * `requests/file/download.rs`, consumed by
 * `responses/object_transfer_handle.rs` when the pull's Receiver handle
 * arrives). Before that registry existed, real ticks carried the TCP
 * connection uuid — this suite's fabricated matching ticks passed while every
 * real download failed on timeout. If the kernel ever stops stamping pull
 * ticks with the DownloadFile request_id, this suite will keep passing and
 * the product will break: the seam is Rust-side, verify it there.
 */
import { describe, it, expect, vi } from 'vitest';
import { eventEmitter } from '@/lib/event-emitter';
import { backendDownloadFile } from '../revfs-io-download';
import type { RevfsIntentResult } from '@/types/revfs-intents';

const CID: bigint = 7n;
const PATH: string = '/docs/notes.txt';

/** Capture the request_id the download used, so ticks can be addressed to it. */
function startDownload(): { pending: Promise<RevfsIntentResult>; requestId: () => string; } {
  let requestId: string = '';
  const deps: { sendInternalServiceRequest: (request: unknown) => Promise<void>; } = {
    sendInternalServiceRequest: async (request: unknown): Promise<void> => {
      const payload: Record<string, string> = (request as Record<string, Record<string, string>>).DownloadFile;
      requestId = payload.request_id;
    },
  };
  const pending: Promise<RevfsIntentResult> = backendDownloadFile(deps, CID, null, PATH);
  return { pending, requestId: (): string => requestId };
}

const tick = (requestId: string, status: unknown): void =>
  eventEmitter.emit('websocket-message', {
    FileTransferTickNotification: { request_id: requestId, status },
  });

describe('a RE-VFS download', () => {
  it('completes on ReceptionComplete, reporting where the file landed', async () => {
    const { pending, requestId } = startDownload();
    await Promise.resolve();

    tick(requestId(), { ReceptionBeginning: ['/tmp/notes.txt', {}] });
    tick(requestId(), 'ReceptionComplete');

    const result: RevfsIntentResult = await pending;
    expect(result).toEqual({
      type: 'backend-download-file',
      success: true,
      downloadPath: '/tmp/notes.txt',
    });
  });

  it('fails on Fail rather than waiting out the timeout', async () => {
    const { pending, requestId } = startDownload();
    await Promise.resolve();

    tick(requestId(), { Fail: 'disk full' });

    expect(await pending).toEqual({ type: 'backend-download-file', success: false });
  });

  it('ignores a tick belonging to a different request', async () => {
    vi.useFakeTimers();
    const { pending, requestId } = startDownload();
    await Promise.resolve();

    // A concurrent transfer for the same session. Correlating on cid — as this
    // used to — would settle this download with someone else's outcome.
    tick('some-other-request', 'ReceptionComplete');

    let settled: boolean = false;
    void pending.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    tick(requestId(), 'ReceptionComplete');
    expect(await pending).toMatchObject({ success: true });
    vi.useRealTimers();
  });
});
