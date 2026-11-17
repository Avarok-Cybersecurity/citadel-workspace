/**
 * Copying a file charged the quota for bytes that were never stored.
 *
 * `calculateStorageUsage` summed `fileSize` per NODE. But a copy shares its
 * original's blob: `tree-byte-refs` exists precisely because several nodes can
 * point at one `virtualDirectory`, and `removeFileFromPeer` refuses to delete
 * the bytes until the last reference goes — round 497's work rests on the same
 * fact.
 *
 * So copying a 10 MB file added 10 MB to the reported usage while consuming
 * nothing, and the quota this feeds gates uploads. Enough copies and the user is
 * refused an upload against space they have not used.
 */
import { describe, it, expect } from 'vitest';
import { calculateStorageUsage } from '../quota-check';
import { RevfsFileState, TreeScope } from '@/types/revfs-types';
import type { RevfsNode } from '@/types/revfs-types';

function file(path: string, byteKey: string, size: number): RevfsNode {
  return {
    name: path.slice(1),
    type: 'file',
    path,
    createdAt: 1,
    updatedAt: 1,
    fileState: RevfsFileState.Remote,
    fileMetadata: {
      fileId: path,
      fileName: path.slice(1),
      fileSize: size,
      fileType: 'text/plain',
      virtualDirectory: byteKey,
      uploadedByCid: 1n,
    },
  } as unknown as RevfsNode;
}

function tree(children: RevfsNode[]): RevfsNode {
  return { name: '', type: 'directory', path: '/', createdAt: 0, updatedAt: 0, children } as unknown as RevfsNode;
}

describe('storage usage', () => {
  it('counts a single file once', () => {
    expect(calculateStorageUsage(tree([file('/a.txt', 'blob-1', 10)]), TreeScope.Peer)).toBe(10);
  });

  it('does not charge twice for a copy that shares the blob', () => {
    // Two nodes, one blob: the copy consumed no storage.
    const withCopy: RevfsNode = tree([
      file('/a.txt', 'blob-1', 10),
      file('/copy-of-a.txt', 'blob-1', 10),
    ]);

    expect(
      calculateStorageUsage(withCopy, TreeScope.Peer),
      'the copy was charged for bytes that were never stored',
    ).toBe(10);
  });

  it('still counts two genuinely different files', () => {
    // The opposite failure: deduping too broadly — by size, or by name — would
    // under-report real usage and let the quota be exceeded silently.
    const twoFiles: RevfsNode = tree([
      file('/a.txt', 'blob-1', 10),
      file('/b.txt', 'blob-2', 10),
    ]);

    expect(calculateStorageUsage(twoFiles, TreeScope.Peer)).toBe(20);
  });

  it('counts a shared blob once across directories', () => {
    // A copy into a subfolder is the ordinary way to make one.
    const nested: RevfsNode = tree([
      file('/a.txt', 'blob-1', 10),
      {
        name: 'sub', type: 'directory', path: '/sub', createdAt: 0, updatedAt: 0,
        children: [file('/sub/a.txt', 'blob-1', 10)],
      } as unknown as RevfsNode,
    ]);

    expect(calculateStorageUsage(nested, TreeScope.Peer)).toBe(10);
  });
});
