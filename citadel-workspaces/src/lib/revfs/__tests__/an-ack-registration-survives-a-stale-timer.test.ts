/**
 * The ack timeout must evict only ITS OWN registration.
 *
 * `registerAck`'s timer deleted by op id alone. Retries re-register the SAME
 * op id, so a stale timer — left behind by an earlier failed attempt — deleted
 * the retry's fresh registration: the real Ack then found nothing to resolve,
 * the retry timed out in turn, and a delivered operation was falsely counted
 * toward the 5-retry give-up.
 *
 * Two companions of the same defect, fixed alongside it:
 *  - a send that fails abandons the pre-created ack promise, which then
 *    REJECTED unheard at its timeout — one unhandledrejection per failed send;
 *  - `retryPendingOps` was not serialised, so two overlapping calls (a double
 *    Sync) each read the full queue and double-sent every operation in it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RevfsState } from '../revfs-state';
import { retryPendingOps, type RetryDeps, type RetryOutcome } from '../revfs-retry';
import type { RevfsIO } from '../revfs-io';
import { RevfsOpType } from '@/types/revfs-types';
import type { RevfsOperation, RevfsPendingOp } from '@/types/revfs-types';

/**
 * Mock justification: RevfsIO is the I/O boundary (SBIO). These tests drive
 * the retry logic and RevfsState directly; persistence answers are inert.
 */
const inertIo = (): RevfsIO =>
  ({ execute: async (): Promise<undefined> => undefined } as unknown as RevfsIO);

const pendingOp = (opId: string): RevfsPendingOp => ({
  operation: { op_id: opId, op_type: RevfsOpType.Mkdir, path: '/d', timestamp: 0 },
  retryCount: 0,
  createdAt: 0,
});

describe('ack registration lifetime', () => {
  beforeEach((): void => {
    vi.useFakeTimers();
  });
  afterEach((): void => {
    vi.useRealTimers();
  });

  it('a stale timer does not evict a newer registration for the same op id', async () => {
    const state: RevfsState = new RevfsState();

    const first: Promise<boolean> = state.registerAck('op-1', 15_000);
    first.catch((): void => undefined); // its own timeout is expected

    // The send behind `first` failed; 14s later the op is retried and
    // registered again under the same id.
    await vi.advanceTimersByTimeAsync(14_000);
    const second: Promise<boolean> = state.registerAck('op-1', 15_000);
    let result: string = 'unresolved';
    second.then(
      (v: boolean): void => { result = `acked:${v}`; },
      (): void => { result = 'timed out'; },
    );

    // The STALE timer fires…
    await vi.advanceTimersByTimeAsync(1_000);
    // …and then the real Ack for the retry arrives.
    state.resolveAck('op-1', true);
    await vi.advanceTimersByTimeAsync(20_000);

    expect(result, 'the stale timer evicted the retry, so its real Ack was lost').toBe('acked:true');
  });

  it('cancelAck settles an unanswerable registration without a rejection', async () => {
    const state: RevfsState = new RevfsState();

    const abandoned: Promise<boolean> = state.registerAck('op-2', 15_000);
    state.cancelAck('op-2');

    await expect(abandoned).resolves.toBe(false);
    expect(state.pendingAcks.size).toBe(0);
    // The timer was cleared; nothing fires (a rejection here would fail the
    // run as an unhandled error).
    await vi.advanceTimersByTimeAsync(30_000);
  });

  it('a failed send withdraws its registration instead of abandoning it', async () => {
    const state: RevfsState = new RevfsState();
    state.addPendingOp('k-failed-send', pendingOp('op-3'));

    const deps: RetryDeps = {
      state,
      io: inertIo(),
      sendOp: async (): Promise<boolean> => false,
    };
    const outcome: RetryOutcome = await retryPendingOps(deps, 'k-failed-send', 2n);

    expect(outcome.stillPending).toBe(1);
    expect(
      state.pendingAcks.size,
      'the failed send left a registration behind to reject unheard at its timeout',
    ).toBe(0);
  });
});

describe('overlapping retry passes', () => {
  it('a second call runs after the first, so nothing is double-sent', async () => {
    const state: RevfsState = new RevfsState();
    state.addPendingOp('k-serial', pendingOp('op-4'));

    let sends: number = 0;
    const deps: RetryDeps = {
      state,
      io: inertIo(),
      sendOp: async (_peer: bigint, op: RevfsOperation): Promise<boolean> => {
        sends += 1;
        // Hold the pass open across a real tick, the window in which the
        // unserialised version let a second pass read the same queue.
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
        queueMicrotask((): void => state.resolveAck(op.op_id, true));
        return true;
      },
    };

    const [, secondOutcome] = await Promise.all([
      retryPendingOps(deps, 'k-serial', 2n),
      retryPendingOps(deps, 'k-serial', 2n),
    ]);

    expect(sends, 'both passes read the queue and the op went out twice').toBe(1);
    expect(secondOutcome).toEqual({ stillPending: 0, discarded: 0 });
  });
});
