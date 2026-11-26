/**
 * Which clock bounds a RE-VFS push, and when.
 *
 * Until the receiver accepts the file (TransferBeginning) the page times the push from its
 * request (FILE_SEND_MS): the SDK puts no deadline on accepting a file header, so without this
 * a header nobody accepts would wait for ever. After that the SDK bounds the wait for the first
 * group's answer and ends a stalled transfer with `Failed`
 * (code 666) before FILE_SEND_MS would pass, and a push queued behind an earlier transfer may
 * rightly wait far longer than FILE_SEND_MS. So the page's idle timer starts at the first
 * TransferTick, each tick re-arms it, and nothing else counts as a sign of life: a failure
 * status ends the push, and a status the page does not know is ignored.
 *
 * Real: the transport (backendSendFile) and the tick reading. Fake: the clock, and the agent's
 * frames, emitted by hand (push-harness.ts).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BACKEND_TIMEOUT_MS } from '../revfs-io-network';
import { TIMEOUT } from '@/lib/timeout-constants';
import { STALLED_TRANSFER_COPY, FILE_TRANSFER_STALLED_CODE } from '@/lib/file-transfer/transfer-failure';
import { dispatchAck, settled, startUpload, tick } from './push-harness';

const CID: bigint = 11n;
const PEER: bigint = 42n;
/** Ten minutes: far past FILE_SEND_MS, inside the SDK's ~616 s bound for a queued header. */
const A_LONG_QUEUE_MS: number = 600_000;

afterEach(() => {
  vi.useRealTimers();
});

describe('a RE-VFS push the receiver has not accepted', () => {
  it('fails FILE_SEND_MS after its request, saying the file was not accepted', async () => {
    vi.useFakeTimers();
    const { pending, requestId } = startUpload(CID, PEER, 'push-f');
    await Promise.resolve();

    dispatchAck(requestId());
    await vi.advanceTimersByTimeAsync(BACKEND_TIMEOUT_MS - 1);
    expect(await settled(pending)).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ type: 'backend-send-file', success: false, reason: `The other side did not accept the file within ${TIMEOUT.FILE_SEND_MS / 1000} s.` });
  });
});

describe('a RE-VFS push, once the receiver accepted it', () => {
  it('runs no page timer while it waits for its first group', async () => {
    vi.useFakeTimers();
    const { pending, requestId } = startUpload(CID, PEER, 'push-a');
    await Promise.resolve();

    dispatchAck(requestId());
    tick(requestId(), 'TransferBeginning');
    await vi.advanceTimersByTimeAsync(A_LONG_QUEUE_MS);

    expect(await settled(pending)).toBe(false);
    tick(requestId(), 'TransferComplete');
    expect(await pending).toMatchObject({ success: true });
  });

  it('is given up on once FILE_SEND_MS passes after its last TransferTick', async () => {
    vi.useFakeTimers();
    const { pending, requestId } = startUpload(CID, PEER, 'push-b');
    await Promise.resolve();

    dispatchAck(requestId());
    tick(requestId(), 'TransferBeginning');
    tick(requestId(), { TransferTick: [1n, 4n, 2.5] });
    await vi.advanceTimersByTimeAsync(BACKEND_TIMEOUT_MS - 1);
    expect(await settled(pending)).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ type: 'backend-send-file', success: false, reason: `Nothing answered for ${BACKEND_TIMEOUT_MS / 1000} s.` });
  });

  it('does not count a status it does not know as a sign of life', async () => {
    vi.useFakeTimers();
    const { pending, requestId } = startUpload(CID, PEER, 'push-c');
    await Promise.resolve();

    dispatchAck(requestId());
    tick(requestId(), { TransferTick: [1, 4, 2.5] });
    await vi.advanceTimersByTimeAsync(BACKEND_TIMEOUT_MS - 1_000);
    tick(requestId(), { SomethingNewer: [1, 2] });
    await vi.advanceTimersByTimeAsync(1_000);

    expect(await pending).toMatchObject({ success: false, reason: `Nothing answered for ${BACKEND_TIMEOUT_MS / 1000} s.` });
  });

  it('ends at once on the SDK\'s coded failure, in words for the person', async () => {
    vi.useFakeTimers();
    const { pending, requestId } = startUpload(CID, PEER, 'push-d');
    await Promise.resolve();

    dispatchAck(requestId());
    tick(requestId(), 'TransferBeginning');
    tick(requestId(), { Failed: { code: FILE_TRANSFER_STALLED_CODE, message: 'The other side stopped answering group 0 of this file transfer; the transfer was ended' } });

    expect(await settled(pending)).toBe(true);
    expect(await pending).toEqual({ type: 'backend-send-file', success: false, reason: STALLED_TRANSFER_COPY });
  });

  it('reports another code\'s failure in the SDK\'s own words', async () => {
    const { pending, requestId } = startUpload(CID, PEER, 'push-e');
    await Promise.resolve();

    dispatchAck(requestId());
    tick(requestId(), { Failed: { code: 12, message: 'the receiver refused the file' } });

    expect(await pending).toEqual({ type: 'backend-send-file', success: false, reason: 'the receiver refused the file' });
  });
});
