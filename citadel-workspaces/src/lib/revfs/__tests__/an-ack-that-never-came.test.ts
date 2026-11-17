/**
 * A timeout is not an acknowledgement.
 *
 * `sendAndAwaitAck` resolved `void` whether the peer answered or the fifteen
 * second budget ran out, so no caller could tell the two apart. Round 413's
 * diagnostic sat after that await and reported "acknowledged by peer" for both,
 * and CI duly showed an acknowledgement logged 15.000s after the send — for an
 * operation the peer never applied. The peer's own log records applying only
 * the Mkdir ops; the Rmdir and the PlaceFile never reached it.
 *
 * Queuing the op for retry on a timeout is right. Reporting success is not.
 */
import { describe, it, expect } from 'vitest';
import { sendAndAwaitAck } from '../revfs-retry';
import type { RevfsOperation } from '@/types/revfs-types';

const OP: RevfsOperation = {
  op_id: 'op-1', op_type: 'Rmdir', path: '/x', timestamp: 1,
} as unknown as RevfsOperation;

function deps(ackResult: Promise<boolean>, sent: boolean): Parameters<typeof sendAndAwaitAck>[0] {
  return {
    state: {
      registerAck: (): Promise<boolean> => ackResult,
      // A failed send withdraws its registration so the abandoned promise
      // cannot reject unheard at its timeout; this fake needs the method.
      cancelAck: (): void => {},
      addPendingOp: (): void => {},
      getPendingOps: (): unknown[] => [],
    },
    io: { execute: async (): Promise<void> => {} },
    sendOp: async (): Promise<boolean> => sent,
  } as unknown as Parameters<typeof sendAndAwaitAck>[0];
}

describe('sending an operation to a peer', () => {
  it('reports true only when the peer actually acknowledged', async () => {
    const acked: boolean = await sendAndAwaitAck(deps(Promise.resolve(true), true), 9n, OP, 'k' as never);
    expect(acked).toBe(true);
  });

  it('reports false when the ack times out', async () => {
    const acked: boolean = await sendAndAwaitAck(
      deps(Promise.reject(new Error('timeout')), true), 9n, OP, 'k' as never,
    );
    expect(acked).toBe(false);
  });

  it('reports false when the send itself did not go out', async () => {
    // The third state, and it was silent too: nothing left the browser and the
    // caller was told the same `undefined` as a success.
    const acked: boolean = await sendAndAwaitAck(deps(Promise.resolve(true), false), 9n, OP, 'k' as never);
    expect(acked).toBe(false);
  });
});
