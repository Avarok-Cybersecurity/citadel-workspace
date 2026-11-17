/**
 * An operation from a peer, arriving while a local upload is in flight, was
 * erased when the upload finished.
 *
 * Every local mutator on `RevfsService` runs under `withSerialLock` on the
 * tree's key — the lock added after a bulk delete had each operation capture the
 * same base tree and the last write resurrect everything the others removed.
 * `handleRevfsOperation` takes no lock at all.
 *
 * `uploadFileToPeer` reads the tree, then awaits `backend-send-file`, then
 * applies `treePlaceFile` to what it read BEFORE that await and calls `setTree`.
 * The send is a real network transfer with a 30-second ceiling. Anything a peer
 * did in that window — a mkdir, a rename, a delete — applied to the live tree,
 * was persisted, was repainted, and was then overwritten by the upload's stale
 * snapshot. Locally gone; on the peer's side still present. Silent divergence.
 *
 * `concurrent-remote-ops-do-not-clobber.test.ts` records that an earlier attempt
 * to test this shape drove a local write during `getTree`'s own await and passed
 * with the fix reverted, because `getTree` re-checks after that await. This
 * window is a different one: the snapshot is held across the BACKEND SEND, which
 * nothing re-checks.
 */
import { describe, it, expect } from 'vitest';
import { RevfsOpType } from '@/types/revfs-types';
import type { RevfsIntent, RevfsIntentResult } from '@/types/revfs-intents';
import type { RevfsNode, RevfsOperation, RevfsFileMetadata } from '@/types/revfs-types';
import { createTestService, defaultIntentHandler, getState, ALICE, BOB } from './revfs-service-test-helpers';
import type { RevfsService } from '../revfs-service';
import type { RevfsState } from '../revfs-state';
import { createDefaultTree, peerTreeKey } from '../tree-queries';

function pathsIn(tree: RevfsNode | undefined): string[] {
  return (tree?.children ?? []).map((child) => child.path).sort();
}

const META: RevfsFileMetadata = {
  fileName: 'mine.txt',
  fileSize: 4,
  fileType: 'text/plain',
  virtualDirectory: '/mine.txt',
} as RevfsFileMetadata;

describe('a peer operation arriving during a slow upload', () => {
  it('is not erased when the upload writes its result', async (): Promise<void> => {
    let releaseSend: () => void = (): void => {};
    const sendGate: Promise<void> = new Promise<void>((resolve) => { releaseSend = resolve; });

    const service: RevfsService = createTestService(
      (intent: RevfsIntent): RevfsIntentResult => defaultIntentHandler()(intent),
    );

    // Hold `backend-send-file` open, the way a real transfer does.
    const io: { execute: (i: RevfsIntent) => Promise<RevfsIntentResult> } =
      (service as unknown as { io: { execute: (i: RevfsIntent) => Promise<RevfsIntentResult> } }).io;
    const inner: (i: RevfsIntent) => Promise<RevfsIntentResult> = io.execute.bind(io);
    io.execute = async (intent: RevfsIntent): Promise<RevfsIntentResult> => {
      if (intent.type === 'backend-send-file') await sendGate;
      return inner(intent);
    };

    const state: RevfsState = getState(service);
    const key: string = peerTreeKey(ALICE, BOB);
    state.setTree(key, createDefaultTree());

    // 1. The upload starts and blocks on the send, holding its snapshot.
    const upload: Promise<boolean> = service.uploadFileToPeer(
      ALICE, BOB, '/', 'mine.txt', META, new Uint8Array([1, 2, 3, 4]),
    );
    // Let it reach the gate.
    for (let i: number = 0; i < 20; i++) await Promise.resolve();

    // 2. The peer's operation arrives mid-flight.
    const fromPeer: RevfsOperation = {
      op_id: 'peer-1', op_type: RevfsOpType.Mkdir, path: '/theirs', timestamp: 5,
    };
    const inbound: Promise<void> = service.handleRevfsOperation(BOB, ALICE, fromPeer);

    // 3. The send completes and the upload writes what it read in step 1.
    releaseSend();
    await upload;
    await inbound;

    expect(
      pathsIn(state.getTree(key)),
      'the upload wrote back a snapshot taken before the peer operation applied',
    ).toEqual(expect.arrayContaining(['/mine.txt', '/theirs']));
  });

  it('still applies a peer operation when nothing else is running', async (): Promise<void> => {
    // The opposite failure: a lock that never releases would make every inbound
    // operation vanish, and the assertion above alone cannot tell the two apart.
    const service: RevfsService = createTestService(
      (intent: RevfsIntent): RevfsIntentResult => defaultIntentHandler()(intent),
    );
    const state: RevfsState = getState(service);
    const key: string = peerTreeKey(ALICE, BOB);
    state.setTree(key, createDefaultTree());

    await service.handleRevfsOperation(BOB, ALICE, {
      op_id: 'peer-2', op_type: RevfsOpType.Mkdir, path: '/alone', timestamp: 6,
    });

    expect(pathsIn(state.getTree(key))).toContain('/alone');
  });

  it('does not queue an Ack behind the mutator that is waiting for it', async (): Promise<void> => {
    // The deadlock the first version of this lock caused, and the reason Ack is
    // exempt. `sendAndAwaitAck` runs INSIDE the lock and blocks until the peer
    // acknowledges; routing that acknowledgement through the same lock means the
    // mutator holds it waiting for an Ack that is waiting for the mutator.
    // Every peer operation would then fail on its ack timeout.
    const service: RevfsService = createTestService(defaultIntentHandler(), { autoAck: false });
    const state: RevfsState = getState(service);
    state.setTree(peerTreeKey(ALICE, BOB), createDefaultTree());

    const mkdir: Promise<boolean> = service.mkdir(ALICE, BOB, '/docs');

    // Let mkdir take the lock and reach its ack wait.
    for (let i: number = 0; i < 50; i++) await Promise.resolve();

    const sent: RevfsOperation | undefined = (
      (service as unknown as { io: { execute: { mock: { calls: [RevfsIntent][] } } } }).io.execute.mock.calls
        .map(([intent]) => intent)
        .filter((intent): intent is RevfsIntent & { operation: RevfsOperation } => intent.type === 'send-revfs-op')
        .map((intent) => intent.operation)
        .find((operation) => operation.op_type === RevfsOpType.Mkdir)
    );
    expect(sent, 'mkdir never sent its operation').toBeDefined();

    await service.handleRevfsOperation(BOB, ALICE, {
      op_id: 'ack-1', op_type: RevfsOpType.Ack, path: '/docs',
      ack_op_id: (sent as RevfsOperation).op_id, success: true, timestamp: 7,
    });

    // Resolves only if the Ack was allowed past the lock mkdir is holding.
    await expect(
      Promise.race([
        mkdir,
        new Promise((_, reject) => setTimeout(() => reject(new Error('deadlocked')), 1500)),
      ]),
    ).resolves.toBe(true);
  });
});
