import { describe, it, expect, vi, beforeEach } from 'vitest';
import { persistTree, markTreeRead, resetTreeReadTracking } from '../persist-tree';
import type { RevfsIO } from '../revfs-io';
import type { RevfsNode } from '@/types/revfs-types';

/**
 * A tree assembled without a successful read must never reach disk.
 *
 * `getTree` already distinguishes "no tree yet" from "the tree could not be
 * read", and its own comment states the stake: reaching the default branch
 * after a storage failure "writes that default over a tree still on disk, and
 * the user's files are gone". It correctly refuses to persist.
 *
 * But it still RETURNS the empty default to its caller — and all twenty callers
 * write the whole tree back through `persistTree`, which had no such guard. So
 * the fix stopped `getTree` destroying the index and left every one of its
 * callers doing it.
 *
 * The worst path needs no action by the person who loses the data. An inbound
 * peer operation reads the tree, applies the peer's `Mkdir` to the empty
 * default, and persists three nodes over forty. Bob's folder creation destroys
 * Alice's file index; the write SUCCEEDS, so no failure event fires; and the
 * blobs remain on the backend with nothing left pointing at them.
 *
 * `persistPendingOps` is this function's twin for the retry queue and has
 * carried this guard all along, under a header saying it belongs "on the single
 * function every write funnels through, not at the call sites".
 */
function io(): { io: RevfsIO; writes: string[] } {
  const writes: string[] = [];
  const fake: { execute: ReturnType<typeof vi.fn> } = {
    execute: vi.fn(async (intent: { type: string; treeKey?: string }) => {
      if (intent.type === 'persist-tree') {
        writes.push(intent.treeKey ?? '<none>');
        return { type: 'persist-tree', success: true };
      }
      return { type: intent.type, success: true };
    }),
  };
  return { io: fake as unknown as RevfsIO, writes };
}

const TREE: RevfsNode = { name: '/', type: 'directory', children: [] } as unknown as RevfsNode;

describe('writing a tree that was never read', () => {
  beforeEach(() => {
    resetTreeReadTracking();
  });

  it('is refused', async () => {
    const { io: fake, writes } = io();

    await persistTree(fake, 'peer_1_2', TREE);

    expect(
      writes,
      'a tree assembled without a successful read replaced whatever is on disk — for an ' +
        'unreadable key that is the empty default over the user\'s whole file index',
    ).toEqual([]);
  });

  it('is allowed once that key has been read', async () => {
    const { io: fake, writes } = io();

    markTreeRead('peer_1_2');
    await persistTree(fake, 'peer_1_2', TREE);

    expect(writes).toEqual(['peer_1_2']);
  });

  it('tracks keys separately, because reading one peer says nothing about another', async () => {
    const { io: fake, writes } = io();

    markTreeRead('peer_1_2');
    await persistTree(fake, 'peer_1_3', TREE);

    expect(writes, "peer 3's tree was written on the strength of having read peer 2's").toEqual([]);
  });

  it('reports the refusal rather than failing silently', async () => {
    const { io: fake } = io();
    const seen: unknown[] = [];
    const { eventEmitter } = await import('@/lib/event-emitter');
    const handler: (payload: unknown) => void = (payload: unknown): void => { seen.push(payload); };
    eventEmitter.on('revfs:persist-failed', handler);

    await persistTree(fake, 'peer_9_9', TREE);
    eventEmitter.off('revfs:persist-failed', handler);

    // A refusal that says nothing is a silent data-loss prevention that looks
    // exactly like a silent data loss.
    expect(seen).toHaveLength(1);
  });
});
