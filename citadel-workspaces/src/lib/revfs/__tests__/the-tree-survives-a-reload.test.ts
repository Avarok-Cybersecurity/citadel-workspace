/**
 * A folder and file stored in a peer's storage are still listed after a reload.
 *
 * Live: alice uploaded revfs-0925.bin into RootDocs0925 in Bob's storage; the
 * bytes are on bob's agent. After a reload the view showed only Received Files
 * and Sent Files, "0 B used".
 *
 * Runs the real service, the real RevfsIO and the real OPFS adapter against an
 * in-memory OPFS. Only the network intents are answered here (the bytes' send,
 * and the peer's ack), because a reload is a disk round trip, not a network one.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RevfsService } from '../revfs-service';
import { resetTreeReadTracking } from '../persist-tree';
import { findNode } from '../tree-operations';
import { calculateStorageUsage } from '../quota-check';
import { installFakeOpfs } from './fake-opfs';
import { RevfsOpType, TreeScope, type RevfsNode, type RevfsOperation } from '@/types/revfs-types';
import type { RevfsIntent, RevfsIntentResult } from '@/types/revfs-intents';
import type { RevfsState } from '../revfs-state';

const ALICE: bigint = 100n;
const BOB: bigint = 200n;

/** A service as a fresh page load builds it: new instance, nothing read yet. */
function freshPage(me: bigint = ALICE): RevfsService {
  resetTreeReadTracking();
  const service: RevfsService = new RevfsService();
  service.initialize({
    sendP2PMessageReliable: vi.fn(async (): Promise<void> => {}),
    getCurrentCid: async (): Promise<bigint> => me,
    sendInternalServiceRequest: vi.fn(async (): Promise<void> => {}),
    // The channel is up: these tests are about what travels over it.
    openPeerChannel: async (): Promise<boolean> => true,
  });
  const internals: { io: { execute: (i: RevfsIntent) => Promise<RevfsIntentResult> }; state: RevfsState } =
    service as unknown as { io: { execute: (i: RevfsIntent) => Promise<RevfsIntentResult> }; state: RevfsState };
  const real: (i: RevfsIntent) => Promise<RevfsIntentResult> = internals.io.execute.bind(internals.io);
  internals.io.execute = async (intent: RevfsIntent): Promise<RevfsIntentResult> => {
    if (intent.type === 'backend-send-file') return { type: 'backend-send-file', success: true };
    if (intent.type === 'send-revfs-op') {
      const op: RevfsOperation = intent.operation;
      if (op.op_type !== RevfsOpType.Ack) queueMicrotask(() => internals.state.resolveAck(op.op_id, true));
      return { type: 'send-revfs-op', success: true };
    }
    return real(intent);
  };
  return service;
}

afterEach(() => { vi.unstubAllGlobals(); });

const FILE: { fileId: string; fileName: string; fileSize: number; fileType: string; virtualDirectory: string; uploadedByCid: bigint } = {
  fileId: 'f1', fileName: 'revfs-0925.bin', fileSize: 4096, fileType: 'application/octet-stream', virtualDirectory: '', uploadedByCid: ALICE,
};

describe('after a reload', () => {
  it('still lists the folder and the file stored in the peer, and counts its bytes', async () => {
    installFakeOpfs();
    const before: RevfsService = freshPage();
    await before.mkdir(ALICE, BOB, '/RootDocs0925');
    await before.uploadFileToPeer(ALICE, BOB, '/RootDocs0925', 'revfs-0925.bin',
      { fileId: 'f1', fileName: 'revfs-0925.bin', fileSize: 4096, fileType: 'application/octet-stream', virtualDirectory: '', uploadedByCid: ALICE },
      new Uint8Array(4096));

    const after: RevfsService = freshPage();
    const tree: RevfsNode = await after.getTree(ALICE, BOB);
    expect(findNode(tree, '/RootDocs0925')).not.toBeNull();
    expect(findNode(tree, '/RootDocs0925/revfs-0925.bin')).not.toBeNull();
    expect(calculateStorageUsage(tree, TreeScope.Peer)).toBe(4096);
  });

  it('is not overwritten by the other account in the same browser', async () => {
    // Two accounts in one browser is the documented way to use this app, and
    // OPFS is per ORIGIN. The tree was stored under the sorted cid pair, so
    // alice's view and bob's view of their shared storage were one file, and
    // whichever tab wrote last replaced the other's.
    installFakeOpfs();
    const alice: RevfsService = freshPage(ALICE);
    const bob: RevfsService = freshPage(BOB);
    await bob.getTree(BOB, ALICE);
    await alice.mkdir(ALICE, BOB, '/RootDocs0925');
    await alice.uploadFileToPeer(ALICE, BOB, '/RootDocs0925', 'revfs-0925.bin', FILE, new Uint8Array(4096));
    // Bob's tab, which never heard of the upload, records a chat transfer.
    await bob.addSentFile(BOB, ALICE, { fileName: 'hello.txt', fileSize: 5, fileType: 'text/plain', transferId: 't1' });

    const reloaded: RevfsService = freshPage(ALICE);
    const tree: RevfsNode = await reloaded.getTree(ALICE, BOB);
    expect(findNode(tree, '/RootDocs0925/revfs-0925.bin')).not.toBeNull();
    expect(calculateStorageUsage(tree, TreeScope.Peer)).toBe(4096);
  });
});
