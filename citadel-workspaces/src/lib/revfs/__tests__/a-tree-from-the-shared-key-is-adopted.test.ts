/**
 * Trees stored under the old shared pair key are not lost by the move to
 * per-account keys, and are shown from the reader's side.
 *
 * The account with the SMALLER cid keeps its key (`min_max` is also its own
 * `mine_peer`). The other account's key changed, so without adoption its tree
 * would read as absent and be replaced by an empty default.
 *
 * Drives the real service, IO and OPFS adapter against an in-memory OPFS.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RevfsService } from '../revfs-service';
import { resetTreeReadTracking } from '../persist-tree';
import { RevfsOpfsStorage } from '../opfs-storage';
import { createDefaultTree, findNode, mkdir, placeFile } from '../tree-operations';
import { installFakeOpfs } from './fake-opfs';
import { RevfsFileState, type RevfsNode } from '@/types/revfs-types';

const ALICE: bigint = 100n;
const BOB: bigint = 200n;

function aliceUploaded(): RevfsNode {
  let tree: RevfsNode = createDefaultTree();
  [tree] = mkdir(tree, '/Docs');
  [tree] = placeFile(tree, '/Docs/a.bin', {
    fileId: 'f1', fileName: 'a.bin', fileSize: 10, fileType: '', virtualDirectory: '/Docs/a.bin', uploadedByCid: ALICE,
  }, ALICE);
  return tree;
}

function page(me: bigint): RevfsService {
  resetTreeReadTracking();
  const service: RevfsService = new RevfsService();
  service.initialize({
    sendP2PMessageReliable: vi.fn(async (): Promise<void> => {}),
    getCurrentCid: async (): Promise<bigint> => me,
    sendInternalServiceRequest: vi.fn(async (): Promise<void> => {}),
    // The channel is up: these tests are about what travels over it.
    openPeerChannel: async (): Promise<boolean> => true,
  });
  return service;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('a tree under the shared key', () => {
  it('is adopted by the account whose key changed, from its own side', async () => {
    installFakeOpfs();
    const disk: RevfsOpfsStorage = new RevfsOpfsStorage();
    await disk.saveTree('100_200', aliceUploaded());

    const tree: RevfsNode = await page(BOB).getTree(BOB, ALICE);
    expect(findNode(tree, '/Docs/a.bin')?.fileState).toBe(RevfsFileState.Hosted);
    expect(await disk.loadTree('200_100')).not.toBeNull();
    expect(findNode((await disk.loadTree('100_200'))!, '/Docs/a.bin')?.fileState).toBe(RevfsFileState.Remote);
  });

  it('is read in place by the account whose key did not change', async () => {
    installFakeOpfs();
    // As bob's tab would have written it: the file is Hosted from his side.
    const bobsView: RevfsNode = aliceUploaded();
    findNode(bobsView, '/Docs/a.bin')!.fileState = RevfsFileState.Hosted;
    await new RevfsOpfsStorage().saveTree('100_200', bobsView);
    const tree: RevfsNode = await page(ALICE).getTree(ALICE, BOB);
    // Written by the other account, it carried their view; the uploader's file
    // is Remote to the uploader, or "0 B used" follows.
    expect(findNode(tree, '/Docs/a.bin')?.fileState).toBe(RevfsFileState.Remote);
  });
});
