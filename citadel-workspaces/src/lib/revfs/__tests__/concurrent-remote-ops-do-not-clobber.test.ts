/**
 * Two remote operations arriving together must not overwrite each other.
 *
 * `handleRevfsOperation` awaits the tree, applies the remote op to what it read,
 * and writes that back. `getTree` is `async`, so it yields even on the cached
 * path — and TWO operations arriving together therefore both read the tree
 * before either writes. The second applies its op to a snapshot taken before
 * the first one's write, and `setTree` puts that snapshot back: the first
 * operation is gone from memory, persisted over on disk, and repainted,
 * because `setTree` notifies.
 *
 * A first version of this test drove a LOCAL write during the load instead, and
 * passed with the fix reverted — `getTree` already re-checks after its own
 * await, so that window is covered and the test could not fail. Two concurrent
 * REMOTE operations is the window that is not.
 *
 * CI measured it as a file that appeared and then vanished:
 *
 *   File visible: true
 *   Attempt 1: File visible: false, expected visible: retry...
 *   Final result: File visible: false, expected visible: FAIL
 *
 * A merge is not the fix. This is the path that carries RemoveFile and Rmdir,
 * and `mergeTrees` is union-only by design, so merging would undo every remote
 * deletion. Applying to the freshest tree is.
 */
import { describe, it, expect } from 'vitest';
import { RevfsOpType } from '@/types/revfs-types';
import type { RevfsIntent, RevfsIntentResult } from '@/types/revfs-intents';
import type { RevfsNode, RevfsOperation } from '@/types/revfs-types';
import { createTestService, defaultIntentHandler, getState, ALICE, BOB } from './revfs-service-test-helpers';
import { RevfsService } from '../revfs-service';
import { RevfsState } from '../revfs-state';
import { createDefaultTree, peerTreeKey } from '../tree-queries';

function treeWith(names: string[]): RevfsNode {
  const base: RevfsNode = createDefaultTree();
  return {
    ...base,
    children: [
      ...(base.children ?? []),
      ...names.map((name) => ({
        name,
        type: 'file' as const,
        path: `/${name}`,
        createdAt: 1,
        updatedAt: 1,
      })),
    ],
  };
}

function pathsIn(tree: RevfsNode | undefined): string[] {
  return (tree?.children ?? []).map((child) => child.path).sort();
}

describe('a remote operation arriving mid-write', () => {
  it('keeps both directories when two arrive together', async (): Promise<void> => {
    const service: RevfsService = createTestService((intent: RevfsIntent): RevfsIntentResult =>
      defaultIntentHandler()(intent),
    );
    const state: RevfsState = getState(service);
    const key: ReturnType<typeof peerTreeKey> = peerTreeKey(ALICE, BOB);
    state.setTree(key, treeWith([]));

    const handle: (sender: bigint, mine: bigint, o: RevfsOperation) => Promise<void> = (
      service as unknown as {
        handleRevfsOperation: (sender: bigint, mine: bigint, o: RevfsOperation) => Promise<void>;
      }
    ).handleRevfsOperation.bind(service);

    const first: RevfsOperation = { op_id: 'r1', op_type: RevfsOpType.Mkdir, path: '/first', timestamp: 2 };
    const second: RevfsOperation = { op_id: 'r2', op_type: RevfsOpType.Mkdir, path: '/second', timestamp: 3 };

    // Started together, as two ops off the same channel are.
    await Promise.all([handle(BOB, ALICE, first), handle(BOB, ALICE, second)]);

    expect(
      pathsIn(state.getTree(key)),
      'the second operation applied to a snapshot taken before the first one wrote',
    ).toEqual(expect.arrayContaining(['/first', '/second']));
  });
});

describe('the same remote operation arriving twice', () => {
  it('answers a redelivered SyncRequest once, not twice', async (): Promise<void> => {
    // The observable harm, and the reason a tree assertion cannot see it:
    // applying `Mkdir /once` twice leaves the same tree, so duplicate work is
    // invisible there. The COST is the reply. Run 33304689050: seven
    // `SyncRequest`s sent, one hundred handled, and a hundred 564-byte
    // `SyncResponse`s went back down the reliable channel -- with the
    // `PlaceFile` and `Rmdir` the user asked for queued behind them, never
    // arriving.
    const { forgetSeenOperations } = await import('../seen-operations');
    forgetSeenOperations();

    const sent: string[] = [];
    const service: RevfsService = createTestService((intent: RevfsIntent): RevfsIntentResult => {
      if (intent.type === 'send-revfs-op') {
        sent.push(intent.operation.op_type);
        return { type: 'send-revfs-op', success: true };
      }
      return defaultIntentHandler()(intent);
    });
    const state: RevfsState = getState(service);
    const key: ReturnType<typeof peerTreeKey> = peerTreeKey(ALICE, BOB);
    state.setTree(key, treeWith([]));

    const handle: (sender: bigint, mine: bigint, o: RevfsOperation) => Promise<void> = (
      service as unknown as {
        handleRevfsOperation: (sender: bigint, mine: bigint, o: RevfsOperation) => Promise<void>;
      }
    ).handleRevfsOperation.bind(service);

    const ask: RevfsOperation = { op_id: 'sync-1', op_type: RevfsOpType.SyncRequest, path: '/', timestamp: 2 };
    await handle(BOB, ALICE, ask);
    await handle(BOB, ALICE, ask);
    await handle(BOB, ALICE, ask);

    expect(sent.filter((t: string): boolean => t === RevfsOpType.SyncResponse)).toHaveLength(1);
  });

  it('still answers a genuinely new SyncRequest', async (): Promise<void> => {
    // Positive control: a dedupe that answers nothing would pass the test above.
    const { forgetSeenOperations } = await import('../seen-operations');
    forgetSeenOperations();

    const sent: string[] = [];
    const service: RevfsService = createTestService((intent: RevfsIntent): RevfsIntentResult => {
      if (intent.type === 'send-revfs-op') {
        sent.push(intent.operation.op_type);
        return { type: 'send-revfs-op', success: true };
      }
      return defaultIntentHandler()(intent);
    });
    const state: RevfsState = getState(service);
    state.setTree(peerTreeKey(ALICE, BOB), treeWith([]));

    const handle: (sender: bigint, mine: bigint, o: RevfsOperation) => Promise<void> = (
      service as unknown as {
        handleRevfsOperation: (sender: bigint, mine: bigint, o: RevfsOperation) => Promise<void>;
      }
    ).handleRevfsOperation.bind(service);

    await handle(BOB, ALICE, { op_id: 'sync-a', op_type: RevfsOpType.SyncRequest, path: '/', timestamp: 2 });
    await handle(BOB, ALICE, { op_id: 'sync-b', op_type: RevfsOpType.SyncRequest, path: '/', timestamp: 3 });

    expect(sent.filter((t: string): boolean => t === RevfsOpType.SyncResponse)).toHaveLength(2);
  });
});

describe('an operation the sender retried', () => {
  it('is acknowledged again, so the retry queue can drain', async (): Promise<void> => {
    // `retryPendingOps` resends with the SAME op id when an ack never came
    // back. A receiver that has already applied it and stays silent leaves the
    // sender retrying for ever -- which is what the first version of the
    // dedupe did: it fixed duplicate work and created a stuck queue.
    const { forgetSeenOperations } = await import('../seen-operations');
    forgetSeenOperations();

    const sent: string[] = [];
    const service: RevfsService = createTestService((intent: RevfsIntent): RevfsIntentResult => {
      if (intent.type === 'send-revfs-op') {
        sent.push(intent.operation.op_type);
        return { type: 'send-revfs-op', success: true };
      }
      return defaultIntentHandler()(intent);
    });
    const state: RevfsState = getState(service);
    state.setTree(peerTreeKey(ALICE, BOB), treeWith([]));

    const handle: (sender: bigint, mine: bigint, o: RevfsOperation) => Promise<void> = (
      service as unknown as {
        handleRevfsOperation: (sender: bigint, mine: bigint, o: RevfsOperation) => Promise<void>;
      }
    ).handleRevfsOperation.bind(service);

    const made: RevfsOperation = { op_id: 'retry-1', op_type: RevfsOpType.Mkdir, path: '/again', timestamp: 2 };
    await handle(BOB, ALICE, made);
    await handle(BOB, ALICE, made);

    // Applied once, acknowledged twice.
    expect(pathsIn(state.getTree(peerTreeKey(ALICE, BOB)))).toEqual(expect.arrayContaining(['/again']));
    expect(sent.filter((t: string): boolean => t === RevfsOpType.Ack)).toHaveLength(2);
  });
});
