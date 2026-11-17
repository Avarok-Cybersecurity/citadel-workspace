/**
 * An upload is listed on the uploader's side at once, counts toward usage, and
 * is acknowledged by the peer's browser from wherever in the app it is.
 *
 * Live, after the per-account keys: "Not confirmed by the peer yet — Uploaded:
 * revfs-0925.bin on this device", and the listing still only Received Files /
 * Sent Files, "0 B used", before and after a reload; bob's tab sat on
 * /workspace the whole time.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { twoAccounts, ALICE, BOB, type TwoAccounts } from './two-accounts';
import { findNode } from '../tree-operations';
import { calculateStorageUsage } from '../quota-check';
import { resetTreeReadTracking } from '../persist-tree';
import { RevfsFileState, TreeScope, type RevfsNode, type RevfsFileMetadata } from '@/types/revfs-types';

const META: RevfsFileMetadata = {
  fileId: 'f1', fileName: 'revfs-0925.bin', fileSize: 4900, fileType: 'application/octet-stream', virtualDirectory: '', uploadedByCid: ALICE,
};

afterEach(() => { vi.unstubAllGlobals(); resetTreeReadTracking(); });

describe('an upload into the peer', () => {
  it('is acknowledged, listed and counted on the uploader side, and held on the peer side', async () => {
    const { alice, bob }: TwoAccounts = await twoAccounts();
    await alice.getTree(ALICE, BOB);

    const acknowledged: boolean = await alice.uploadFileToPeer(ALICE, BOB, '/', 'revfs-0925.bin', META, new Uint8Array(4900));

    const mine: RevfsNode = await alice.getTree(ALICE, BOB);
    expect(findNode(mine, '/revfs-0925.bin')?.fileState).toBe(RevfsFileState.Remote);
    expect(calculateStorageUsage(mine, TreeScope.Peer)).toBe(4900);
    expect(acknowledged).toBe(true);
    const theirs: RevfsNode = await bob.getTree(BOB, ALICE);
    expect(findNode(theirs, '/revfs-0925.bin')?.fileState).toBe(RevfsFileState.Hosted);
  }, 20_000);
});
