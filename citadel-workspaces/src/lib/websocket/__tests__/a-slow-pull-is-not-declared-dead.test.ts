/**
 * A pull that is still ticking is alive, however long it has been running.
 *
 * `awaitPullCompletion` armed one fixed timer, so any download longer than the
 * window reported "could not be downloaded" while it was still transferring
 * and still consuming bandwidth. The upload twin (revfs-io-network.ts) had the
 * fix the whole time: an idle timeout, re-armed on every event for THIS
 * request. This ports it — and pins the two behaviours the port must keep:
 * a genuinely quiet pull still times out, and only THIS pull's ticks count.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { awaitPullCompletion, type PullOutcome } from '../pull-completion';
import { eventEmitter } from '../../event-emitter';

const WINDOW_MS: number = 30_000;

function tick(requestId: string, status: unknown): void {
  eventEmitter.emit('websocket-message', {
    FileTransferTickNotification: { request_id: requestId, status },
  });
}

describe('awaitPullCompletion', () => {
  beforeEach((): void => {
    vi.useFakeTimers();
  });
  afterEach((): void => {
    vi.useRealTimers();
    eventEmitter.off('websocket-message');
  });

  it('outlives the fixed window while the transfer keeps ticking', async () => {
    const outcome: Promise<PullOutcome> = awaitPullCompletion('req-slow', WINDOW_MS, 'test');

    // 60 seconds of wall time, never more than 20s between ticks.
    await vi.advanceTimersByTimeAsync(20_000);
    tick('req-slow', { TransferTick: {} });
    await vi.advanceTimersByTimeAsync(20_000);
    tick('req-slow', { ReceptionBeginning: { path: '/tmp/pulled.bin' } });
    await vi.advanceTimersByTimeAsync(20_000);
    tick('req-slow', 'ReceptionComplete');

    await expect(outcome).resolves.toEqual({ success: true, downloadPath: '/tmp/pulled.bin' });
  });

  it('still times out a pull that goes genuinely quiet', async () => {
    // The opposite direction: "re-arm on progress" must not decay into
    // "never time out" — a transfer nobody is answering still fails honestly.
    const outcome: Promise<PullOutcome> = awaitPullCompletion('req-stalled', WINDOW_MS, 'test');

    tick('req-stalled', { TransferTick: {} });
    await vi.advanceTimersByTimeAsync(WINDOW_MS + 1);

    await expect(outcome).resolves.toEqual({ success: false, message: 'timed out' });
  });

  it("is not kept alive by another pull's ticks", async () => {
    const outcome: Promise<PullOutcome> = awaitPullCompletion('req-mine', WINDOW_MS, 'test');

    await vi.advanceTimersByTimeAsync(20_000);
    tick('req-other', { TransferTick: {} });
    await vi.advanceTimersByTimeAsync(WINDOW_MS - 20_000 + 1);

    await expect(outcome).resolves.toEqual({ success: false, message: 'timed out' });
  });
});
