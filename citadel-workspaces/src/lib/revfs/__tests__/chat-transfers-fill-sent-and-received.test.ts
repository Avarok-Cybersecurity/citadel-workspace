/**
 * The file manager's "Sent Files" / "Received Files" folders list what was sent
 * and received in chat.
 *
 * Live (2026-10-04, two users, real transfers both ways): both folders stayed
 * empty. `addSentFile` / `addReceivedFile` existed and were tested, but nothing
 * in production called them -- a completed chat transfer never reached the tree
 * the file manager renders.
 */
import { describe, it, expect } from 'vitest';
import { eventEmitter } from '@/lib/event-emitter';
import { FILE_TRANSFER_EVENTS } from '@/lib/file-transfer/events';
import type { FileTransfer } from '@/lib/file-transfer/types';
import { RevfsFileState, RevfsOpType, type RevfsNode, type RevfsOperation } from '@/types/revfs-types';
import { findNode } from '../tree-operations';
import { recordForCompletedTransfer } from '../transfer-records';
import { ALICE, BOB, createTestService, defaultIntentHandler, getExecuteCalls } from './revfs-service-test-helpers';
import type { RevfsService } from '../revfs-service';

function transfer(over: Partial<FileTransfer>): FileTransfer {
  return {
    id: 't-1', fileName: 'report.pdf', fileSize: 10, fileType: 'application/pdf',
    state: 'complete', progress: 100,
    senderCid: ALICE.toString(), recipientCid: BOB.toString(),
    createdAt: 1, updatedAt: 2, isIncoming: false, ...over,
  };
}

/** Lets the async listener and the serial lock run to completion. */
async function settle(): Promise<void> {
  for (let i: number = 0; i < 20; i += 1) await new Promise((r) => setTimeout(r, 0));
}

function childrenOf(tree: RevfsNode, path: string): RevfsNode[] {
  return findNode(tree, path)?.children ?? [];
}

describe('recordForCompletedTransfer (pure)', () => {
  it('records an outgoing completion as Sent, from the sender to the recipient', () => {
    expect(recordForCompletedTransfer(transfer({}))).toEqual({
      kind: 'sent', myCid: ALICE, peerCid: BOB,
      entry: { fileName: 'report.pdf', fileSize: 10, fileType: 'application/pdf', transferId: 't-1' },
    });
  });

  it('records an incoming completion as Received under the recipient, with where it was saved', () => {
    const t: FileTransfer = transfer({
      isIncoming: true, senderCid: BOB.toString(), recipientCid: ALICE.toString(), downloadPath: '/data/x.pdf',
    });
    expect(recordForCompletedTransfer(t)).toEqual({
      kind: 'received', myCid: ALICE, peerCid: BOB,
      entry: { fileName: 'report.pdf', fileSize: 10, fileType: 'application/pdf', transferId: 't-1', downloadPath: '/data/x.pdf' },
    });
  });

  it('records nothing for a transfer that ended in failure', () => {
    // COMPLETED is emitted for failures too (applyTransferOutcome).
    expect(recordForCompletedTransfer(transfer({ state: 'error' }))).toBeNull();
  });
});

describe('a completed chat transfer appears in the file manager', () => {
  it('lists an outgoing transfer under Sent Files, once, and tells the peer nothing', async () => {
    const service: RevfsService = createTestService(defaultIntentHandler());
    await service.getTree(ALICE, BOB);
    const t: FileTransfer = transfer({ id: 'sent-once' });
    eventEmitter.emit(FILE_TRANSFER_EVENTS.COMPLETED, t);
    eventEmitter.emit(FILE_TRANSFER_EVENTS.COMPLETED, t);
    await settle();

    const sent: RevfsNode[] = childrenOf(await service.getTree(ALICE, BOB), '/Sent Files')
      .filter((n) => n.fileMetadata?.fileId === 'sent-once');
    expect(sent).toHaveLength(1);
    expect(sent[0].fileState).toBe(RevfsFileState.Sent);

    // A PlaceFile under /Sent Files would land in the PEER's Sent Files, as
    // if they had sent it.
    const ops: RevfsOperation[] = getExecuteCalls(service)
      .filter((i) => i.type === 'send-revfs-op')
      .map((i) => (i as { operation: RevfsOperation }).operation);
    expect(ops.filter((op) => op.path.startsWith('/Sent Files'))).toEqual([]);
  });

  it('lists an incoming transfer under Received Files with its saved path', async () => {
    const service: RevfsService = createTestService(defaultIntentHandler());
    await service.getTree(ALICE, BOB);
    eventEmitter.emit(FILE_TRANSFER_EVENTS.COMPLETED, transfer({
      id: 'got-it', isIncoming: true, senderCid: BOB.toString(), recipientCid: ALICE.toString(),
      downloadPath: 'C:\\Users\\a\\x.pdf',
    }));
    await settle();

    const got: RevfsNode | undefined = childrenOf(await service.getTree(ALICE, BOB), '/Received Files')
      .find((n) => n.fileMetadata?.fileId === 'got-it');
    expect(got?.fileState).toBe(RevfsFileState.Received);
    expect(got?.fileMetadata?.virtualDirectory).toBe('C:\\Users\\a\\x.pdf');
  });

  it('keeps both of two different files that share a name', async () => {
    const service: RevfsService = createTestService(defaultIntentHandler());
    await service.addSentFile(ALICE, BOB, { fileName: 'a.txt', fileSize: 1, fileType: 'text/plain', transferId: 'first' });
    await service.addSentFile(ALICE, BOB, { fileName: 'a.txt', fileSize: 2, fileType: 'text/plain', transferId: 'second' });

    const names: string[] = childrenOf(await service.getTree(ALICE, BOB), '/Sent Files').map((n) => n.name).sort();
    expect(names).toEqual(['a (2).txt', 'a.txt']);
  });
});

describe('the special folders are this account\'s records, not shared tree', () => {
  it('does not send them to the peer in a SyncResponse', async () => {
    const service: RevfsService = createTestService(defaultIntentHandler());
    await service.addSentFile(ALICE, BOB, { fileName: 'mine.txt', fileSize: 1, fileType: 'text/plain', transferId: 's1' });
    await service.handleRevfsOperation(BOB, ALICE, {
      op_id: 'sync-q', op_type: RevfsOpType.SyncRequest, path: '/', timestamp: Date.now(),
    });

    const response: RevfsOperation | undefined = getExecuteCalls(service)
      .filter((i) => i.type === 'send-revfs-op')
      .map((i) => (i as { operation: RevfsOperation }).operation)
      .find((op) => op.op_type === RevfsOpType.SyncResponse);
    expect(response?.tree).toBeDefined();
    expect(childrenOf(response!.tree!, '/Sent Files')).toEqual([]);
  });

  it('does not merge the peer\'s records into ours from their SyncResponse', async () => {
    const service: RevfsService = createTestService(defaultIntentHandler());
    const peerTree: RevfsNode = await createTestService(defaultIntentHandler()).getTree(BOB, ALICE);
    childrenOf(peerTree, '/Sent Files').push({
      name: 'theirs.txt', type: 'file', path: '/Sent Files/theirs.txt', fileState: RevfsFileState.Sent,
      createdAt: 1, updatedAt: 1,
    });
    findNode(peerTree, '/Sent Files')!.children = childrenOf(peerTree, '/Sent Files');
    await service.handleRevfsOperation(BOB, ALICE, {
      op_id: 'sync-a', op_type: RevfsOpType.SyncResponse, path: '/', tree: peerTree, timestamp: Date.now(),
    });

    expect(childrenOf(await service.getTree(ALICE, BOB), '/Sent Files')).toEqual([]);
  });
});
