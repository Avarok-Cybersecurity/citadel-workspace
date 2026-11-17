/**
 * Renaming or moving a file must not hand its bytes to the next upload.
 *
 * A file's bytes live under its upload-time key (`virtualDirectory`), which a
 * rename or move cannot change: the backend has send / download / delete and no
 * way to re-path an object. Uploads chose that key as the file's path, without
 * asking whether anything already used it. So upload `/notes.txt`, rename it to
 * `/old.txt` (still keyed `/notes.txt`), upload a new `/notes.txt` — and the new
 * bytes went out under the renamed file's key. `old.txt` then downloaded the new
 * file's contents, with nothing on screen to say so.
 *
 * Driven through the real RevfsService with only the I/O boundary mocked.
 */
import { describe, it, expect } from 'vitest';
import { ALICE, BOB, createTestService, defaultIntentHandler, getExecuteCalls } from './revfs-service-test-helpers';
import { findNode } from '../tree-operations';
import type { RevfsFileMetadata, RevfsNode } from '@/types/revfs-types';
import type { RevfsService } from '@/lib/revfs/revfs-service';

const BYTES: Uint8Array<ArrayBuffer> = new Uint8Array([1, 2, 3]);
function meta(fileId: string): RevfsFileMetadata {
  return { fileId, fileName: 'notes.txt', fileSize: 3, fileType: 'text/plain', virtualDirectory: '', uploadedByCid: ALICE };
}

function sentKeys(service: RevfsService): string[] {
  return getExecuteCalls(service)
    .filter(i => i.type === 'backend-send-file')
    .map(i => (i as { virtualDir: string }).virtualDir);
}

function keyOf(tree: RevfsNode, path: string): string | undefined {
  return findNode(tree, path)?.fileMetadata?.virtualDirectory;
}

describe('an upload after a rename (peer storage)', () => {
  it('stores the new bytes under a key nobody else uses', async () => {
    const service: RevfsService = createTestService(defaultIntentHandler());
    await service.uploadFileToPeer(ALICE, BOB, '/', 'notes.txt', meta('f1'), BYTES);
    await service.rename(ALICE, BOB, '/notes.txt', 'old.txt');
    await service.uploadFileToPeer(ALICE, BOB, '/', 'notes.txt', meta('f2'), BYTES);

    const [first, second] = sentKeys(service);
    expect(second).not.toBe(first);
    const tree: RevfsNode = await service.getTree(ALICE, BOB);
    expect(keyOf(tree, '/old.txt')).toBe(first);
    expect(keyOf(tree, '/notes.txt')).toBe(second);
  });

  it('still overwrites in place when the path is simply uploaded again', async () => {
    const service: RevfsService = createTestService(defaultIntentHandler());
    await service.uploadFileToPeer(ALICE, BOB, '/', 'notes.txt', meta('f1'), BYTES);
    await service.uploadFileToPeer(ALICE, BOB, '/', 'notes.txt', meta('f2'), BYTES);
    expect(sentKeys(service)).toEqual(['/notes.txt', '/notes.txt']);
  });
});

describe('an upload after a move (server storage)', () => {
  it('stores the new bytes under a key nobody else uses', async () => {
    const service: RevfsService = createTestService(defaultIntentHandler());
    await service.serverMkdir(ALICE, '/archive');
    await service.uploadFileToServer(ALICE, '/', 'notes.txt', meta('f1'), BYTES);
    await service.serverMove(ALICE, '/notes.txt', '/archive');
    await service.uploadFileToServer(ALICE, '/', 'notes.txt', meta('f2'), BYTES);

    const [first, second] = sentKeys(service);
    expect(second).not.toBe(first);
    const tree: RevfsNode = await service.getServerTree(ALICE);
    expect(keyOf(tree, '/archive/notes.txt')).toBe(first);
    expect(keyOf(tree, '/notes.txt')).toBe(second);
  });
});
