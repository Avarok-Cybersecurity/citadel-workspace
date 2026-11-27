/**
 * A RE-VFS upload must not report success until the bytes have actually been
 * accepted by the node that stores them.
 *
 * `backendSendFile` used to resolve on `SendFileRequestSuccess`, which the
 * internal service emits the moment `remote.send(...)` QUEUES the SendObject —
 * before the receiving side has seen, let alone accepted, anything. A
 * peer-scoped REVFS push then arrived at the peer's internal service as a
 * transfer waiting for an explicit accept that nothing ever issued, so no
 * bytes were streamed — while the uploader, told "success", placed the node,
 * persisted the tree, and synced the op to the peer. Both trees listed a
 * "downloadable" file whose bytes existed nowhere.
 *
 * The honest terminal signal is the Sender-side `TransferComplete` tick: the
 * receiver only acks the file header AFTER accepting, and TransferComplete
 * only fires once every chunk has been streamed and acknowledged. Like the
 * download suite, the fixture ticks addressed to the browser's request_id are
 * a CONTRACT with the kernel: `requests/file/upload.rs` registers the
 * SendFile request_id in `kernel/revfs_correlation.rs` for REVFS pushes and
 * `responses/object_transfer_handle.rs` stamps the Sender tick stream with it.
 * (The peer-side acceptance itself is kernel-side too: the receiving internal
 * service auto-accepts REVFS pushes the way the server kernel always has.)
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { RevfsIntentResult } from '@/types/revfs-intents';
import { dispatchAck, emit, settled, startUpload as startPush, tick } from './push-harness';

const CID: bigint = 7n;

function startUpload(peerCid: bigint | null = 42n): { pending: Promise<RevfsIntentResult>; requestId: () => string; } {
  return startPush(CID, peerCid, 'push-1');
}

afterEach(() => {
  vi.useRealTimers();
});

describe('a RE-VFS upload', () => {
  it('does NOT resolve on the dispatch ack — that only means "queued"', async () => {
    vi.useFakeTimers();
    const { pending, requestId } = startUpload();
    await Promise.resolve();

    dispatchAck(requestId());

    // Resolving here is the exact defect: success reported for a push the
    // peer never accepted, over a file whose bytes exist nowhere.
    expect(await settled(pending)).toBe(false);

    tick(requestId(), 'TransferComplete');
    expect(await pending).toEqual({
      type: 'backend-send-file',
      success: true,
      virtualDir: '/docs/notes.txt',
    });
  });

  it('fails on a Fail tick rather than waiting out the timeout', async () => {
    const { pending, requestId } = startUpload();
    await Promise.resolve();

    dispatchAck(requestId());
    tick(requestId(), { Fail: 'peer declined' });

    expect(await pending).toEqual({ type: 'backend-send-file', success: false, reason: 'peer declined' });
  });

  it('fails on SendFileRequestFailure', async () => {
    const { pending, requestId } = startUpload();
    await Promise.resolve();

    emit({ SendFileRequestFailure: { request_id: requestId(), message: 'no peer' } });

    expect(await pending).toEqual({ type: 'backend-send-file', success: false, reason: 'no peer' });
  });

  it("ignores another transfer's completion tick", async () => {
    vi.useFakeTimers();
    const { pending, requestId } = startUpload();
    await Promise.resolve();

    dispatchAck(requestId());
    // A concurrent transfer for the same session; before the kernel stamped
    // REVFS ticks with the SendFile request_id there was nothing to tell
    // these apart.
    tick('some-other-request', 'TransferComplete');
    expect(await settled(pending)).toBe(false);

    tick(requestId(), 'TransferComplete');
    expect(await pending).toMatchObject({ success: true });
  });

  it('stays alive across the idle timeout while progress ticks arrive', async () => {
    vi.useFakeTimers();
    const { pending, requestId } = startUpload();
    await Promise.resolve();

    dispatchAck(requestId());

    // A large transfer legitimately outlives the fixed 30s window; each
    // progress tick proves it is still moving and re-arms the timer.
    for (let i: number = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(20_000);
      tick(requestId(), { TransferTick: [i, 10, 1.5] });
    }
    expect(await settled(pending)).toBe(false);

    tick(requestId(), 'TransferComplete');
    expect(await pending).toMatchObject({ success: true });
  });

  it('fails when nothing answers at all', async () => {
    vi.useFakeTimers();
    const { pending } = startUpload();
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(31_000);

    expect(await pending).toEqual({ type: 'backend-send-file', success: false, reason: 'Nothing answered for 30 s.' });
  });
});
