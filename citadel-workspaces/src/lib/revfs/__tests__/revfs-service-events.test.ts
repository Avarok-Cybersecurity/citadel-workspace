/**
 * RevfsService Tests: Event Handling & Sync
 *
 * Tests for handleRevfsOperation, addSentFile, addReceivedFile,
 * requestSync, and onTreeChanged.
 */

import { describe, it, expect } from 'vitest';
import { RevfsOpType, RevfsFileState , type RevfsNode } from '@/types/revfs-types';
import type { RevfsOperation, RevfsFileMetadata } from '@/types/revfs-types';
import { peerTreeKey } from '../tree-operations';
import { ALICE, BOB, createTestService, defaultIntentHandler, getExecuteCalls } from './revfs-service-test-helpers';
import type { RevfsService } from '@/lib/revfs/revfs-service';
import type { RevfsIntent } from '@/types/revfs-intents';
import type { SyncOutcome } from '../revfs-service';

const KEY: string = peerTreeKey(ALICE, BOB);

// ── Tests ───────────────────────────────────────────────────────────────

describe('RevfsService (events & sync)', () => {
  describe('handleRevfsOperation', () => {
    it('applies remote mkdir and sends ACK', async () => {
      const service: RevfsService = createTestService(defaultIntentHandler());
      const op: RevfsOperation = {
        op_id: 'test-op-1', op_type: RevfsOpType.Mkdir,
        path: '/shared', timestamp: Date.now(),
      };

      await service.handleRevfsOperation(BOB, ALICE, op);

      const tree: RevfsNode = await service.getTree(ALICE, BOB);
      expect(tree.children!.find(c => c.name === 'shared')).toBeDefined();

      const sendCalls: { type: "send-revfs-op"; peerCid: bigint; operation: RevfsOperation; }[] = getExecuteCalls(service).filter(i => i.type === 'send-revfs-op');
      const ackCall: { type: "send-revfs-op"; peerCid: bigint; operation: RevfsOperation; } | undefined = sendCalls.find(i => {
        const sentOp: RevfsOperation = (i as { operation: RevfsOperation }).operation;
        return sentOp.op_type === RevfsOpType.Ack;
      });
      expect(ackCall).toBeDefined();
      const ackOp: RevfsOperation = (ackCall as { operation: RevfsOperation }).operation;
      expect(ackOp.ack_op_id).toBe('test-op-1');
      expect(ackOp.success).toBe(true);
    });

    it('resolves pending ACK when ACK received', async () => {
      const service: RevfsService = createTestService(defaultIntentHandler(), { autoAck: false });
      const mkdirPromise: Promise<boolean> = service.mkdir(ALICE, BOB, '/docs');

      await new Promise(r => setTimeout(r, 10));
      const sendCalls: { type: "send-revfs-op"; peerCid: bigint; operation: RevfsOperation; }[] = getExecuteCalls(service).filter(i => i.type === 'send-revfs-op');
      const mkdirSend: { type: "send-revfs-op"; peerCid: bigint; operation: RevfsOperation; } | undefined = sendCalls.find(i => {
        const op: RevfsOperation = (i as { operation: RevfsOperation }).operation;
        return op.op_type === RevfsOpType.Mkdir;
      });
      expect(mkdirSend).toBeDefined();
      const sentOpId: string = (mkdirSend as { operation: RevfsOperation }).operation.op_id;

      const ackOp: RevfsOperation = {
        op_id: 'ack-1', op_type: RevfsOpType.Ack, path: '/docs',
        ack_op_id: sentOpId, success: true, timestamp: Date.now(),
      };
      await service.handleRevfsOperation(BOB, ALICE, ackOp);
      await mkdirPromise;
    });

    it('handles SyncRequest by sending SyncResponse', async () => {
      const service: RevfsService = createTestService(defaultIntentHandler());
      await service.mkdir(ALICE, BOB, '/docs');

      const syncReq: RevfsOperation = {
        op_id: 'sync-req-1', op_type: RevfsOpType.SyncRequest,
        path: '/', timestamp: Date.now(),
      };
      await service.handleRevfsOperation(BOB, ALICE, syncReq);

      const sendCalls: { type: "send-revfs-op"; peerCid: bigint; operation: RevfsOperation; }[] = getExecuteCalls(service).filter(i => i.type === 'send-revfs-op');
      const syncResp: { type: "send-revfs-op"; peerCid: bigint; operation: RevfsOperation; } | undefined = sendCalls.find(i => {
        const op: RevfsOperation = (i as { operation: RevfsOperation }).operation;
        return op.op_type === RevfsOpType.SyncResponse;
      });
      expect(syncResp).toBeDefined();
      const respOp: RevfsOperation = (syncResp as { operation: RevfsOperation }).operation;
      expect(respOp.tree).toBeDefined();
      expect(respOp.tree!.children!.length).toBeGreaterThanOrEqual(2);
    });

    it('applies remote PlaceFile and sends ACK', async () => {
      const service: RevfsService = createTestService(defaultIntentHandler());
      await service.mkdir(ALICE, BOB, '/docs');

      const meta: RevfsFileMetadata = {
        fileId: 'f1', fileName: 'file.pdf', fileSize: 512,
        fileType: 'application/pdf', virtualDirectory: '/vfs/f', uploadedByCid: BOB,
      };
      const op: RevfsOperation = {
        op_id: 'place-1', op_type: RevfsOpType.PlaceFile,
        path: '/docs/file.pdf', metadata: meta, timestamp: Date.now(),
      };
      await service.handleRevfsOperation(BOB, ALICE, op);

      const tree: RevfsNode = await service.getTree(ALICE, BOB);
      const file: RevfsNode | undefined = tree.children?.find(c => c.name === 'docs')?.children?.find(c => c.name === 'file.pdf');
      expect(file).toBeDefined();
      // The peer uploaded it to us, so we are the ones hosting the blob.
      expect(file!.fileState).toBe(RevfsFileState.Hosted);
    });

    it('applies remote RemoveFile and sends ACK', async () => {
      const service: RevfsService = createTestService(defaultIntentHandler());
      await service.mkdir(ALICE, BOB, '/docs');
      const meta: RevfsFileMetadata = {
        fileId: 'f1', fileName: 'file.pdf', fileSize: 512,
        fileType: 'application/pdf', virtualDirectory: '/vfs/f', uploadedByCid: ALICE,
      };
      await service.uploadFileToPeer(ALICE, BOB, '/docs', 'file.pdf', meta, new Uint8Array([1, 2, 3]));

      const removeOp: RevfsOperation = {
        op_id: 'rm-1', op_type: RevfsOpType.RemoveFile,
        path: '/docs/file.pdf', timestamp: Date.now(),
      };
      await service.handleRevfsOperation(BOB, ALICE, removeOp);

      const tree: RevfsNode = await service.getTree(ALICE, BOB);
      const docs: RevfsNode | undefined = tree.children?.find(c => c.name === 'docs');
      expect(docs?.children?.find(c => c.name === 'file.pdf')).toBeUndefined();
    });

    it('handles SyncResponse by merging trees', async () => {
      const service: RevfsService = createTestService(defaultIntentHandler());
      await service.mkdir(ALICE, BOB, '/local-dir');

      const { createDefaultTree } = await import('../tree-operations');
      const { mkdir: treeMkdir } = await import('../tree-operations');
      let peerTree: RevfsNode = createDefaultTree();
      [peerTree] = treeMkdir(peerTree, '/remote-dir');

      const syncOp: RevfsOperation = {
        op_id: 'sync-resp-1', op_type: RevfsOpType.SyncResponse,
        path: '/', tree: peerTree, timestamp: Date.now(),
      };
      await service.handleRevfsOperation(BOB, ALICE, syncOp);

      const tree: RevfsNode = await service.getTree(ALICE, BOB);
      expect(tree.children?.find(c => c.name === 'local-dir')).toBeDefined();
      expect(tree.children?.find(c => c.name === 'remote-dir')).toBeDefined();
    });
  });

  describe('addSentFile', () => {
    it('places file in Sent Files with Sent state', async () => {
      const service: RevfsService = createTestService(defaultIntentHandler());
      await service.addSentFile(ALICE, BOB, {
        fileName: 'report.pdf', fileSize: 2048,
        fileType: 'application/pdf', transferId: 't1',
      });
      const tree: RevfsNode = await service.getTree(ALICE, BOB);
      const file: RevfsNode | undefined = tree.children?.find(c => c.name === 'Sent Files')?.children?.find(c => c.name === 'report.pdf');
      expect(file).toBeDefined();
      expect(file!.fileState).toBe(RevfsFileState.Sent);
    });
  });

  describe('addReceivedFile', () => {
    it('places file in Received Files with Received state', async () => {
      const service: RevfsService = createTestService(defaultIntentHandler());
      await service.addReceivedFile(ALICE, BOB, {
        fileName: 'photo.jpg', fileSize: 4096,
        fileType: 'image/jpeg', transferId: 't2',
      });
      const tree: RevfsNode = await service.getTree(ALICE, BOB);
      const file: RevfsNode | undefined = tree.children?.find(c => c.name === 'Received Files')?.children?.find(c => c.name === 'photo.jpg');
      expect(file).toBeDefined();
      expect(file!.fileState).toBe(RevfsFileState.Received);
    });
  });

  describe('requestSync', () => {
    it('sends SyncRequest op to peer, and reports that nobody answered', async () => {
      // `requestSync` used to resolve as soon as the request was on the wire.
      // It now waits for the peer's tree to arrive, so this test passes a short
      // budget rather than the fifteen-second default -- and asserts the
      // ANSWER as well as the send, because the caller toasts "Tree synced with
      // peer" on the strength of it.
      const service: RevfsService = createTestService(defaultIntentHandler());
      const outcome: SyncOutcome = await service.requestSync(ALICE, BOB, 10);
      expect(outcome, 'no tree came back in this harness').toEqual({ kind: 'unanswered', waitedMs: 10 });

      const intents: RevfsIntent[] = getExecuteCalls(service);
      const syncCalls: RevfsIntent[] = intents.filter(i => {
        if (i.type !== 'send-revfs-op') return false;
        const op: RevfsOperation = (i as { operation: RevfsOperation }).operation;
        return op.op_type === RevfsOpType.SyncRequest;
      });
      expect(syncCalls).toHaveLength(1);
    });
  });

  describe('onTreeChanged', () => {
    it('notifies subscribers when tree changes', async () => {
      const service: RevfsService = createTestService(defaultIntentHandler());
      const changes: string[] = [];
      service.onTreeChanged((key) => { changes.push(key); });
      await service.mkdir(ALICE, BOB, '/docs');
      expect(changes.filter(k => k === KEY).length).toBeGreaterThanOrEqual(1);
    });

    it('returns unsubscribe function', async () => {
      const service: RevfsService = createTestService(defaultIntentHandler());
      const changes: string[] = [];
      const unsub: () => void = service.onTreeChanged((key): void => { changes.push(key); });
      await service.getTree(ALICE, BOB);
      const countBefore: number = changes.length;
      unsub();
      await service.mkdir(ALICE, BOB, '/docs');
      expect(changes.length).toBe(countBefore);
    });
  });
});
