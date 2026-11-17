/**
 * A queued Rename or Move must not be undone by a SyncResponse.
 *
 * The pendingRemovals guard protected RemoveFile and Rmdir — the deletion half
 * of the bug class — and left out the two operations that VACATE a path
 * without destroying bytes. A Rename or Move queued for an unreachable peer
 * was resurrected by the peer's union-merged SyncResponse: old and new path
 * both existed locally while the peer held only the new one, permanently and
 * silently, and a moved directory brought its entire old subtree back.
 *
 * `operation.path` is the OLD path for all four op types, so the guard needs
 * nothing but the two missing entries in its filter.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createTestService,
  defaultIntentHandler,
  getState,
  ALICE,
  BOB,
} from './revfs-service-test-helpers';
import { forgetSeenOperations } from '../seen-operations';
import { createDefaultTree, peerTreeKey } from '../tree-queries';
import { RevfsOpType } from '@/types/revfs-types';
import type { RevfsNode, RevfsOperation } from '@/types/revfs-types';
import type { RevfsService } from '../revfs-service';
import type { RevfsState } from '../revfs-state';

const KEY: string = peerTreeKey(ALICE, BOB);

function file(path: string): RevfsNode {
  return { name: path.split('/').pop() ?? path, type: 'file', path, createdAt: 1, updatedAt: 1 } as RevfsNode;
}

function dir(path: string, children: RevfsNode[]): RevfsNode {
  return {
    name: path.split('/').pop() ?? path,
    type: 'directory',
    path,
    createdAt: 1,
    updatedAt: 1,
    children,
  } as RevfsNode;
}

function withChildren(children: RevfsNode[]): RevfsNode {
  const tree: RevfsNode = createDefaultTree();
  return { ...tree, children: [...(tree.children ?? []), ...children] };
}

function syncResponse(tree: RevfsNode): RevfsOperation {
  return { op_id: crypto.randomUUID(), op_type: RevfsOpType.SyncResponse, path: '/', tree, timestamp: Date.now() };
}

function queuedOp(state: RevfsState, op: Partial<RevfsOperation> & { op_type: RevfsOpType; path: string }): void {
  state.addPendingOp(KEY, {
    operation: { op_id: crypto.randomUUID(), timestamp: Date.now(), ...op },
    retryCount: 0,
    createdAt: Date.now(),
  });
}

const hasPath = (tree: RevfsNode | undefined, path: string): boolean => {
  if (!tree) return false;
  if (tree.path === path) return true;
  return (tree.children ?? []).some((c) => hasPath(c, path));
};

describe('a SyncResponse arriving while a rename or move is queued', () => {
  beforeEach((): void => {
    forgetSeenOperations();
  });

  it('does not resurrect the old path of a pending Rename', async () => {
    const service: RevfsService = createTestService(defaultIntentHandler());
    const state: RevfsState = getState(service);

    // Locally the file is already at its new name; the Rename never reached
    // the peer, so their tree still holds the old one.
    state.setTree(KEY, withChildren([file('/new.txt')]));
    queuedOp(state, { op_type: RevfsOpType.Rename, path: '/old.txt', newName: 'new.txt' });

    await service.handleRevfsOperation(BOB, ALICE, syncResponse(withChildren([file('/old.txt')])));

    const merged: RevfsNode | undefined = state.getTree(KEY);
    expect(hasPath(merged, '/old.txt'), 'the renamed-away path came back beside the new one').toBe(false);
    expect(hasPath(merged, '/new.txt')).toBe(true);
  });

  it('does not resurrect a moved directory or its subtree', async () => {
    const service: RevfsService = createTestService(defaultIntentHandler());
    const state: RevfsState = getState(service);

    state.setTree(KEY, withChildren([dir('/newdir', [file('/newdir/f.txt')])]));
    queuedOp(state, { op_type: RevfsOpType.Move, path: '/olddir', destPath: '/newdir' });

    await service.handleRevfsOperation(
      BOB,
      ALICE,
      syncResponse(withChildren([dir('/olddir', [file('/olddir/f.txt')])])),
    );

    const merged: RevfsNode | undefined = state.getTree(KEY);
    expect(hasPath(merged, '/olddir'), 'the moved directory came back at its old path').toBe(false);
    expect(hasPath(merged, '/olddir/f.txt'), 'the moved subtree was resurrected').toBe(false);
    expect(hasPath(merged, '/newdir/f.txt')).toBe(true);
  });

  it('still adds unrelated peer paths while a rename is queued', async () => {
    // The guard says "do not resurrect", never "do not merge" — a genuinely
    // new file from the peer must still arrive.
    const service: RevfsService = createTestService(defaultIntentHandler());
    const state: RevfsState = getState(service);

    state.setTree(KEY, withChildren([file('/new.txt')]));
    queuedOp(state, { op_type: RevfsOpType.Rename, path: '/old.txt', newName: 'new.txt' });

    await service.handleRevfsOperation(
      BOB,
      ALICE,
      syncResponse(withChildren([file('/old.txt'), file('/theirs.txt')])),
    );

    expect(hasPath(state.getTree(KEY), '/theirs.txt')).toBe(true);
  });
});
