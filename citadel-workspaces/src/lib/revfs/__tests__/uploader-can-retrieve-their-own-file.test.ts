/**
 * The peer-storage round trip, asserted as a property rather than a label.
 *
 * `uploadFileToPeer` sends the bytes to the peer, and `downloadFileFromPeer`
 * pulls them back from the peer. So the uploader's own node must be in a state
 * the download path accepts, and the peer — who is holding an encrypted blob
 * they have no key for — must not be.
 *
 * This got inverted: the uploader was stamped Hosted, which `isDownloadableState`
 * rejects, so a user's own file became permanently un-openable and the UI told
 * them it was "Hosted for peer (encrypted, cannot open)". The peer was stamped
 * Remote and pulled from the uploader's node, where nothing had been stored, so
 * the file was retrievable by nobody. Six tests across the suite asserted the
 * two labels directly and so moved with the bug instead of catching it — hence
 * this one asserts what the user can DO.
 */
import { describe, it, expect } from 'vitest';
import {
  createDefaultTree,
  findNode,
  mkdir,
  placeFile,
  applyRemoteOp,
} from '../tree-operations';
import { isDownloadableState } from '../file-states';
import { calculateStorageUsage } from '../quota-check';
import { RevfsOpType, TreeScope , type RevfsFileMetadata , type RevfsNode } from '@/types/revfs-types';

const UPLOADER: bigint = 111n;
const HOLDER: bigint = 222n;

function makeMeta(uploadedByCid: bigint): RevfsFileMetadata {
  return {
    fileId: 'f1',
    fileName: 'report.pdf',
    fileSize: 4096,
    fileType: 'pdf',
    virtualDirectory: '/docs/report.pdf',
    uploadedByCid,
  };
}

describe('peer storage round trip', () => {
  it('leaves the file retrievable by the uploader and not by the holder', () => {
    const meta: RevfsFileMetadata = makeMeta(UPLOADER);

    // The uploader's own tree, right after sending the bytes away.
    let mine: RevfsNode = createDefaultTree();
    [mine] = mkdir(mine, '/docs');
    [mine] = placeFile(mine, '/docs/report.pdf', meta, UPLOADER);
    const mineNode: RevfsNode | null = findNode(mine, '/docs/report.pdf');
    expect(mineNode).not.toBeNull();
    expect(isDownloadableState(mineNode!.fileState)).toBe(true);

    // The holder's tree, after the same PlaceFile op arrives over the wire.
    let theirs: RevfsNode = createDefaultTree();
    [theirs] = mkdir(theirs, '/docs');
    theirs = applyRemoteOp(
      theirs,
      {
        op_id: '1',
        op_type: RevfsOpType.PlaceFile,
        path: '/docs/report.pdf',
        metadata: meta,
        timestamp: 0,
      },
      HOLDER,
    );
    const theirNode: RevfsNode | null = findNode(theirs, '/docs/report.pdf');
    expect(theirNode).not.toBeNull();
    expect(isDownloadableState(theirNode!.fileState)).toBe(false);

    // The two sides must not agree — that would mean both or neither hold it.
    expect(mineNode!.fileState).not.toBe(theirNode!.fileState);
  });

  it('bills the upload to the uploader, not to whoever stores it', () => {
    const meta: RevfsFileMetadata = makeMeta(UPLOADER);

    let mine: RevfsNode = createDefaultTree();
    [mine] = mkdir(mine, '/docs');
    [mine] = placeFile(mine, '/docs/report.pdf', meta, UPLOADER);

    let theirs: RevfsNode = createDefaultTree();
    [theirs] = mkdir(theirs, '/docs');
    [theirs] = placeFile(theirs, '/docs/report.pdf', meta, HOLDER);

    // Quota gates uploads (`storageQuota - storageUsed`), so "used" has to mean
    // what this user has PUT somewhere.
    expect(calculateStorageUsage(mine, TreeScope.Peer)).toBe(4096);
    expect(calculateStorageUsage(theirs, TreeScope.Peer)).toBe(0);
  });
});
