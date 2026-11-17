/**
 * A file deleted locally came back through a sync, pointing at bytes that were
 * already destroyed.
 *
 * `mergeTrees` is a UNION merge, deliberately: this file's own note says
 * deletions are carried by explicit RemoveFile/RemoveDir operations and never
 * inferred from a missing child, because "never had it" and "deleted it" are
 * indistinguishable in a tree.
 *
 * But a local deletion is not instantaneous on the peer's side. `removeFile`
 * destroys the bytes, removes the node, and QUEUES a RemoveFile op; until the
 * peer applies and acks it, the peer's tree still holds the file. A SyncResponse
 * arriving in that window merges the peer's copy back in — and the node it
 * restores names a `virtualDirectory` whose bytes are gone. The file reappears
 * in the manager, opens to nothing, and counts against the storage quota.
 *
 * The union rule is right; what it lacked was knowledge of what is deliberately
 * on its way out. A path with a removal still pending is not a path we are
 * missing.
 */
import { describe, it, expect } from 'vitest';
import { mergeTrees } from '../tree-copy-merge';
import { createDefaultTree } from '../tree-queries';
import type { RevfsNode } from '@/types/revfs-types';

function withChild(tree: RevfsNode, path: string): RevfsNode {
  return {
    ...tree,
    children: [
      ...(tree.children ?? []),
      { name: path.slice(1), type: 'file', path, createdAt: 1, updatedAt: 1 } as RevfsNode,
    ],
  };
}

describe('merging a peer tree', () => {
  it('adds a file the peer has and we have never seen', () => {
    const local: RevfsNode = createDefaultTree();
    const remote: RevfsNode = withChild(createDefaultTree(), '/theirs.txt');

    const merged: RevfsNode = mergeTrees(local, remote);

    expect(merged.children?.some((c) => c.path === '/theirs.txt')).toBe(true);
  });

  it('does NOT restore a file whose removal is still pending', () => {
    // The window: our bytes are already gone, the peer has not applied the
    // RemoveFile yet, and their tree still lists it.
    const local: RevfsNode = createDefaultTree();
    const remote: RevfsNode = withChild(createDefaultTree(), '/deleted.txt');

    const merged: RevfsNode = mergeTrees(local, remote, new Set(['/deleted.txt']));

    expect(
      merged.children?.some((c) => c.path === '/deleted.txt'),
      'the deleted file came back, naming bytes that no longer exist',
    ).toBe(false);
  });

  it('still adds other files while one removal is pending', () => {
    // The opposite failure: treating a pending removal as "merge nothing" would
    // stall every sync, and the assertion above cannot see it.
    const local: RevfsNode = createDefaultTree();
    let remote: RevfsNode = withChild(createDefaultTree(), '/deleted.txt');
    remote = withChild(remote, '/keep.txt');

    const merged: RevfsNode = mergeTrees(local, remote, new Set(['/deleted.txt']));

    expect(merged.children?.some((c) => c.path === '/keep.txt')).toBe(true);
    expect(merged.children?.some((c) => c.path === '/deleted.txt')).toBe(false);
  });

  it('does not remove a path we still hold just because a removal is pending', () => {
    // The set says "do not RESURRECT this", not "delete this". A local node that
    // is still present is the local truth until its own op runs.
    const local: RevfsNode = withChild(createDefaultTree(), '/mine.txt');
    const remote: RevfsNode = createDefaultTree();

    const merged: RevfsNode = mergeTrees(local, remote, new Set(['/mine.txt']));

    expect(merged.children?.some((c) => c.path === '/mine.txt')).toBe(true);
  });
});

/**
 * And the handler has to supply the set.
 *
 * The tests above call `mergeTrees` directly, so they pass whether or not
 * `revfs-inbound` passes it anything — verified by control, which is why this
 * drives the real SyncResponse path.
 */
import { createTestService, defaultIntentHandler, getState, ALICE, BOB } from './revfs-service-test-helpers';
import { RevfsOpType } from '@/types/revfs-types';
import type { RevfsOperation } from '@/types/revfs-types';
import type { RevfsService } from '../revfs-service';
import type { RevfsState } from '../revfs-state';
import { peerTreeKey } from '../tree-queries';
import { forgetSeenOperations } from '../seen-operations';

describe('a SyncResponse arriving with a removal still queued', () => {
  it('does not restore the deleted file', async (): Promise<void> => {
    forgetSeenOperations();
    const service: RevfsService = createTestService(defaultIntentHandler());
    const state: RevfsState = getState(service);
    const key: string = peerTreeKey(ALICE, BOB);

    // We deleted it: the node is gone here and the op is queued for the peer.
    state.setTree(key, createDefaultTree());
    state.addPendingOp(key, {
      operation: {
        op_id: 'rm-1', op_type: RevfsOpType.RemoveFile, path: '/deleted.txt', timestamp: 1,
      } as RevfsOperation,
      retryCount: 0,
      createdAt: 0,
    });

    // The peer has not applied it yet, so their tree still lists the file.
    await service.handleRevfsOperation(BOB, ALICE, {
      op_id: 'sync-1',
      op_type: RevfsOpType.SyncResponse,
      path: '/',
      tree: withChild(createDefaultTree(), '/deleted.txt'),
      timestamp: 2,
    } as RevfsOperation);

    expect(
      (state.getTree(key) as RevfsNode).children?.some((c: RevfsNode) => c.path === '/deleted.txt'),
      'the sync restored a file we had deleted, naming bytes already destroyed',
    ).toBe(false);
  });

  it('still accepts the peer’s other files', async (): Promise<void> => {
    forgetSeenOperations();
    const service: RevfsService = createTestService(defaultIntentHandler());
    const state: RevfsState = getState(service);
    const key: string = peerTreeKey(ALICE, BOB);
    state.setTree(key, createDefaultTree());
    state.addPendingOp(key, {
      operation: {
        op_id: 'rm-2', op_type: RevfsOpType.RemoveFile, path: '/deleted.txt', timestamp: 1,
      } as RevfsOperation,
      retryCount: 0,
      createdAt: 0,
    });

    let peerTree: RevfsNode = withChild(createDefaultTree(), '/deleted.txt');
    peerTree = withChild(peerTree, '/keep.txt');

    await service.handleRevfsOperation(BOB, ALICE, {
      op_id: 'sync-2', op_type: RevfsOpType.SyncResponse, path: '/', tree: peerTree, timestamp: 2,
    } as RevfsOperation);

    expect(
      (state.getTree(key) as RevfsNode).children?.some((c: RevfsNode) => c.path === '/keep.txt'),
      'a queued removal stalled the whole sync',
    ).toBe(true);
  });
});
