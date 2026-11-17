/**
 * What New folder, Rename and Cut/Copy/Paste really do in P2P storage.
 *
 * The agent's RE-VFS surface is SendFile, DownloadFile and DeleteVirtualFile:
 * no mkdir, rename or move. So these are edits to the TREE — the index both
 * peers keep — and each is real only if it is persisted here AND the peer
 * applies the same change, while the bytes stay under their upload-time key.
 * This drives Alice's real service, replays every op she sent through Bob's
 * real `applyRemoteOp`, and checks the two trees agree and a moved file still
 * downloads from where its bytes are.
 *
 * Only the I/O boundary is mocked (see revfs-service-test-helpers).
 */
import { describe, it, expect } from 'vitest';
import { ALICE, BOB, createTestService, defaultIntentHandler, getExecuteCalls } from './revfs-service-test-helpers';
import { applyRemoteOp, createDefaultTree } from '../tree-operations';
import type { RevfsIntent } from '@/types/revfs-intents';
import type { RevfsNode, RevfsOperation } from '@/types/revfs-types';
import type { RevfsService } from '@/lib/revfs/revfs-service';

function paths(node: RevfsNode): string[] {
  return [node.path, ...(node.children ?? []).flatMap(paths)].sort();
}

function sentToBob(service: RevfsService): RevfsOperation[] {
  return getExecuteCalls(service)
    .filter((i: RevfsIntent): boolean => i.type === 'send-revfs-op')
    .map((i: RevfsIntent) => i as Extract<RevfsIntent, { type: 'send-revfs-op' }>)
    .filter(i => i.peerCid === BOB)
    .map(i => i.operation);
}

describe('P2P storage edits', () => {
  it('are persisted, acknowledged, and leave the peer with the same tree', async () => {
    const service: RevfsService = createTestService(defaultIntentHandler());
    const acks: boolean[] = [
      await service.mkdir(ALICE, BOB, '/Docs'),
      await service.uploadFileToPeer(ALICE, BOB, '/', 'a.txt',
        { fileId: 'f1', fileName: 'a.txt', fileSize: 3, fileType: 'text/plain', virtualDirectory: '', uploadedByCid: ALICE },
        new Uint8Array([1, 2, 3])),
      await service.rename(ALICE, BOB, '/a.txt', 'b.txt'),
      await service.move(ALICE, BOB, '/b.txt', '/Docs'),
      await service.copy(ALICE, BOB, '/Docs/b.txt', '/'),
    ];
    expect(acks).toEqual([true, true, true, true, true]);
    // One write per edit, plus the default tree written when it was first loaded.
    expect(getExecuteCalls(service).filter(i => i.type === 'persist-tree')).toHaveLength(6);

    const alice: RevfsNode = await service.getTree(ALICE, BOB);
    const bob: RevfsNode = sentToBob(service)
      .reduce((tree: RevfsNode, op: RevfsOperation): RevfsNode => applyRemoteOp(tree, op, BOB), createDefaultTree());
    expect(paths(bob)).toEqual(paths(alice));
    expect(paths(alice)).toEqual(expect.arrayContaining(['/Docs/b.txt', '/b.txt']));
  });

  it('leave a moved file downloadable from where its bytes are', async () => {
    const service: RevfsService = createTestService(defaultIntentHandler());
    await service.mkdir(ALICE, BOB, '/Docs');
    await service.uploadFileToPeer(ALICE, BOB, '/', 'a.txt',
      { fileId: 'f1', fileName: 'a.txt', fileSize: 3, fileType: 'text/plain', virtualDirectory: '', uploadedByCid: ALICE },
      new Uint8Array([1, 2, 3]));
    await service.rename(ALICE, BOB, '/a.txt', 'b.txt');
    await service.move(ALICE, BOB, '/b.txt', '/Docs');
    await service.downloadFileFromPeer(ALICE, BOB, '/Docs/b.txt');

    const pull: RevfsIntent | undefined = getExecuteCalls(service).find(i => i.type === 'backend-download-file');
    expect(pull).toMatchObject({ virtualDir: '/a.txt', peerCid: BOB });
  });
});
