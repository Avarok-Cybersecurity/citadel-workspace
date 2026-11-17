/**
 * serverRmdir has to tell the backend to delete the files that were inside the
 * directory. Without that the tree forgets them locally while the bytes — and
 * the user's quota — stay on the server forever.
 *
 * The IO router is the only I/O here and it is injected, so these drive the real
 * operation and assert on the intents it emits.
 */
import { describe, it, expect, vi } from 'vitest';
import { serverRmdir, peerRmdir , type DirOpsContext } from '../revfs-dir-ops';
import { collectFiles } from '../tree-queries';
import { markTreeRead } from '../persist-tree';
import { createDefaultTree, mkdir, placeFile, serverTreeKey } from '../tree-operations';
import type { RevfsNode, RevfsFileMetadata } from '@/types/revfs-types';

const MY_CID: bigint = 7n;

function meta(name: string, dir: string): RevfsFileMetadata {
  return {
    fileId: `id-${name}`,
    fileName: name,
    fileSize: 10,
    fileType: 'text/plain',
    virtualDirectory: dir,
    uploadedByCid: MY_CID,
  };
}

/** A server tree with /docs/a.txt, /docs/deep/b.txt and /keep/c.txt. */
function buildTree(): RevfsNode {
  let tree: RevfsNode = createDefaultTree();
  [tree] = mkdir(tree, '/docs');
  [tree] = mkdir(tree, '/docs/deep');
  [tree] = mkdir(tree, '/keep');
  [tree] = placeFile(tree, '/docs/a.txt', meta('a.txt', '/docs/a.txt'), MY_CID);
  [tree] = placeFile(tree, '/docs/deep/b.txt', meta('b.txt', '/docs/deep/b.txt'), MY_CID);
  [tree] = placeFile(tree, '/keep/c.txt', meta('c.txt', '/keep/c.txt'), MY_CID);
  return tree;
}

function setup(tree: RevfsNode): { ctx: DirOpsContext; executed: Record<string, unknown>[]; } {
  const executed: Array<Record<string, unknown>> = [];
  // Echoes the intent type with success, so it models a backend that ACCEPTS.
  // Returning a bare `{}` could represent neither success nor failure, so any
  // caller that started checking its result would fail against a working
  // backend — which is exactly what happened when serverRmdir began reporting
  // files it could not delete.
  const io: { execute: ReturnType<typeof vi.fn> } = {
    execute: vi.fn((intent: Record<string, unknown>) => {
      executed.push(intent);
      return Promise.resolve({ type: intent.type, success: true });
    }),
  };
  const ctx: DirOpsContext = {
    state: { setTree: vi.fn(), getTree: vi.fn() },
    ensureIO: () => io,
    getTree: vi.fn(() => Promise.resolve(tree)),
    getServerTree: vi.fn(() => Promise.resolve(tree)),
    sendAndAwaitAck: vi.fn(),
  } as unknown as DirOpsContext;

  // These stubs stand in for `getServerTree`, which in production marks the key
  // read on a successful load. `persistTree` refuses to write a tree for a key
  // that was never read -- the guard that stops a peer's operation replacing an
  // unreadable index with an empty default -- so a stub that returns a tree
  // must also say the read happened, or it is modelling a state that cannot
  // occur.
  markTreeRead(serverTreeKey(MY_CID));

  return { ctx, executed };
}

describe('collectFiles', () => {
  it('returns every file beneath a directory, including nested ones', () => {
    const docs: RevfsNode | undefined = buildTree().children?.find((c) => c.name === 'docs');
    expect(collectFiles(docs!).map((f) => f.name).sort()).toEqual(['a.txt', 'b.txt']);
  });

  it('returns nothing for an empty directory', () => {
    let tree: RevfsNode = createDefaultTree();
    [tree] = mkdir(tree, '/empty');
    const empty: RevfsNode | undefined = tree.children?.find((c) => c.name === 'empty');
    expect(collectFiles(empty!)).toEqual([]);
  });
});

describe('serverRmdir', () => {
  it('deletes every file that was under the directory, nested included', async () => {
    const { ctx, executed } = setup(buildTree());

    await serverRmdir(ctx, MY_CID, '/docs');

    const deletes: Record<string, unknown>[] = executed.filter((i) => i.type === 'backend-delete-file');
    expect(deletes.map((d) => d.virtualDir).sort()).toEqual(['/docs/a.txt', '/docs/deep/b.txt']);
  });

  it('does not touch files outside the removed directory', async () => {
    const { ctx, executed } = setup(buildTree());

    await serverRmdir(ctx, MY_CID, '/docs');

    const deleted: unknown[] = executed.filter((i) => i.type === 'backend-delete-file').map((d): unknown => d.virtualDir);
    expect(deleted).not.toContain('/keep/c.txt');
  });

  it('persists the new tree before issuing deletes', async () => {
    const { ctx, executed } = setup(buildTree());

    await serverRmdir(ctx, MY_CID, '/docs');

    const persistAt: number = executed.findIndex((i) => i.type === 'persist-tree');
    const firstDeleteAt: number = executed.findIndex((i) => i.type === 'backend-delete-file');
    expect(persistAt).toBeGreaterThanOrEqual(0);
    expect(persistAt).toBeLessThan(firstDeleteAt);
    expect(executed[persistAt].treeKey).toBe(serverTreeKey(MY_CID));
  });

  it('issues no deletes for an empty directory', async () => {
    let tree: RevfsNode = createDefaultTree();
    [tree] = mkdir(tree, '/empty');
    const { ctx, executed } = setup(tree);

    await serverRmdir(ctx, MY_CID, '/empty');

    expect(executed.filter((i) => i.type === 'backend-delete-file')).toHaveLength(0);
    expect(executed.some((i) => i.type === 'persist-tree')).toBe(true);
  });

  it('removes the directory from the tree it persists', async () => {
    const { ctx, executed } = setup(buildTree());

    await serverRmdir(ctx, MY_CID, '/docs');

    const persisted: RevfsNode = executed.find((i) => i.type === 'persist-tree')?.tree as RevfsNode;
    expect(persisted.children?.some((c) => c.name === 'docs')).toBe(false);
    expect(persisted.children?.some((c) => c.name === 'keep')).toBe(true);
  });

  it('reports the files it could not delete rather than losing them silently', async () => {
    const { ctx } = setup(buildTree());
    // A backend that refuses the deletes. The folder is already gone from the
    // tree by this point, so the user must be told which files are still
    // consuming server storage — otherwise they are unreferenceable and
    // invisible.
    (ctx.ensureIO() as unknown as { execute: ReturnType<typeof vi.fn> }).execute =
      vi.fn((intent: Record<string, unknown>) =>
        Promise.resolve(
          intent.type === 'backend-delete-file'
            ? { type: intent.type, success: false }
            : { type: intent.type, success: true }
        )
      );

    await expect(serverRmdir(ctx, MY_CID, '/docs')).rejects.toThrow(/could not be deleted/);
  });
});

describe('peerRmdir', () => {
  const PEER_CID: bigint = 42n;

  it('deletes the orphaned bytes from peer storage, like its server twin', async () => {
    const { ctx, executed } = setup(buildTree());

    await peerRmdir(ctx, MY_CID, PEER_CID, '/docs');

    const deletes: Record<string, unknown>[] = executed.filter((i) => i.type === 'backend-delete-file');
    // This sent only the tree op. The peer applied it, both sides forgot the
    // files, and every encrypted blob stayed in the host's storage forever —
    // unreferenced and unreclaimable, with no tree entry left to reach it from.
    expect(deletes.map((d) => d.virtualDir).sort()).toEqual(['/docs/a.txt', '/docs/deep/b.txt']);
  });

  it('addresses the deletes to the peer that holds the bytes', async () => {
    const { ctx, executed } = setup(buildTree());

    await peerRmdir(ctx, MY_CID, PEER_CID, '/docs');

    const deletes: Record<string, unknown>[] = executed.filter((i) => i.type === 'backend-delete-file');
    expect(deletes.length).toBeGreaterThan(0);
    for (const d of deletes) {
      expect(d.peerCid).toBe(PEER_CID);
    }
  });

  it('leaves files outside the removed directory alone', async () => {
    const { ctx, executed } = setup(buildTree());

    await peerRmdir(ctx, MY_CID, PEER_CID, '/docs');

    const deleted: unknown[] = executed
      .filter((i) => i.type === 'backend-delete-file')
      .map((d) => d.virtualDir);
    expect(deleted).not.toContain('/keep/c.txt');
  });
});
