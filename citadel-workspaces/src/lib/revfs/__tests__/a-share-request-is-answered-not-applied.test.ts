/**
 * A ShareRequest is handed to the uploader's answer, and is not a tree change.
 *
 * Routed like any inbound operation, a ShareRequest would reach the tree
 * mutator, be refused as an unknown operation and acknowledged `false` --
 * telling the asker "no" before the uploader had looked. It also must not wait
 * behind this tree's serial lock: answering it waits on a pull.
 */
import { describe, it, expect } from 'vitest';
import { RevfsOpType, type RevfsNode, type RevfsOperation } from '@/types/revfs-types';
import { RevfsState } from '../revfs-state';
import { applyInboundOperationSerially, type InboundContext } from '../revfs-inbound';
import { withSerialLock } from '@/lib/serial-queue';
import { peerTreeKey } from '../tree-queries';

const ME: bigint = 1n;
const ASKER: bigint = 2n;

describe('an inbound ShareRequest', () => {
  it('goes to the share answer, and nothing is acknowledged on its behalf', async () => {
    const answered: RevfsOperation[] = [];
    const sentOps: RevfsOperation[] = [];
    const ctx: InboundContext = {
      state: new RevfsState(),
      ensureIO: () => { throw new Error('no tree I/O expected'); },
      getTree: async (): Promise<RevfsNode> => { throw new Error('no tree read expected'); },
      sendOp: async (_p: bigint, op: RevfsOperation): Promise<boolean> => { sentOps.push(op); return true; },
      answerShareRequest: async (asker: bigint, mine: bigint, op: RevfsOperation): Promise<void> => {
        expect([asker, mine]).toEqual([ASKER, ME]);
        answered.push(op);
      },
    };
    const op: RevfsOperation = { op_id: 'share-1', op_type: RevfsOpType.ShareRequest, path: '/atlas.png', timestamp: 1 };

    // Held lock: a routed-through-the-lock answer would never run inside this.
    let release: () => void = () => undefined;
    const held: Promise<void> = withSerialLock(peerTreeKey(ME, ASKER), () => new Promise<void>((r) => { release = r; }));
    await applyInboundOperationSerially(ctx, ASKER, ME, op);
    release();
    await held;

    expect(answered.map((o) => o.op_id)).toEqual(['share-1']);
    expect(sentOps).toEqual([]);
  });
});
