/**
 * A folder created for a peer that never reached the peer was reported as done.
 *
 * `sendAndAwaitAck` was changed to return a boolean precisely so that "the peer
 * never acknowledged this" stops being invisible -- before that it resolved
 * `void` on both success and a 15s timeout, and the log printed "acknowledged
 * by peer" for operations the peer had never applied.
 *
 * The return value then went nowhere. Every peer operation -- mkdir, rmdir,
 * rename, move, copy, remove-file -- awaited it, discarded it, and returned
 * `Promise<void>`. The service, the hook and the file-manager handlers are all
 * `Promise<void>` in turn, so no layer above could have known: the local tree
 * updated, the toast said the folder was created, and the peer's file list
 * never changed. A fix landed one layer down and was never propagated up to
 * where the user is told.
 *
 * The operation IS queued for retry on this path, so "not delivered" would
 * overstate it -- these assert the flag, and the caller says "not yet".
 */
import { describe, it, expect, vi } from 'vitest';
import { peerMkdir, peerRmdir, peerRename, peerMove, peerCopy, type DirOpsContext } from '../revfs-dir-ops';
import { createDefaultTree, mkdir } from '../tree-operations';
import type { RevfsNode } from '@/types/revfs-types';

const MY_CID: bigint = 7n;
const PEER_CID: bigint = 9n;

function tree(): RevfsNode {
  let t: RevfsNode = createDefaultTree();
  [t] = mkdir(t, '/docs');
  [t] = mkdir(t, '/docs/inner');
  [t] = mkdir(t, '/elsewhere');
  return t;
}

function ctxWithAck(acked: boolean): DirOpsContext {
  const io: { execute: ReturnType<typeof vi.fn> } = {
    execute: vi.fn((intent: Record<string, unknown>) => Promise.resolve({ type: intent.type, success: true })),
  };
  return {
    state: { setTree: vi.fn(), getTree: vi.fn() },
    ensureIO: (): unknown => io,
    getTree: vi.fn(() => Promise.resolve(tree())),
    getServerTree: vi.fn(() => Promise.resolve(tree())),
    sendAndAwaitAck: vi.fn(() => Promise.resolve(acked)),
  } as unknown as DirOpsContext;
}

const operations: Array<{ name: string; run: (ctx: DirOpsContext) => Promise<boolean> }> = [
  { name: 'mkdir', run: (c: DirOpsContext): Promise<boolean> => peerMkdir(c, MY_CID, PEER_CID, '/fresh') },
  { name: 'rmdir', run: (c: DirOpsContext): Promise<boolean> => peerRmdir(c, MY_CID, PEER_CID, '/docs') },
  { name: 'rename', run: (c: DirOpsContext): Promise<boolean> => peerRename(c, MY_CID, PEER_CID, '/docs', 'papers') },
  { name: 'move', run: (c: DirOpsContext): Promise<boolean> => peerMove(c, MY_CID, PEER_CID, '/docs/inner', '/elsewhere') },
  { name: 'copy', run: (c: DirOpsContext): Promise<boolean> => peerCopy(c, MY_CID, PEER_CID, '/docs/inner', '/elsewhere') },
];

describe('a peer operation reports whether the peer got it', () => {
  for (const op of operations) {
    it(`${op.name} reports true when the peer acknowledges`, async () => {
      const acknowledged: boolean = await op.run(ctxWithAck(true));
      expect(acknowledged).toBe(true);
    });

    it(`${op.name} reports false when the acknowledgement never comes`, async () => {
      const acknowledged: boolean = await op.run(ctxWithAck(false));
      expect(acknowledged).toBe(false);
    });
  }
});
