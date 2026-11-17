/**
 * RevfsService Tests: Core Operations
 *
 * Tests for getTree, mkdir, rmdir, sendAndAwaitAck, uploadFileToPeer,
 * removeFileFromPeer, downloadFileFromPeer.
 */

import { describe, it, expect } from 'vitest';
import { RevfsOpType, RevfsFileState , type RevfsNode , type TreeKey , type RevfsPendingOp } from '@/types/revfs-types';
import type { RevfsOperation, RevfsFileMetadata } from '@/types/revfs-types';
import { createDefaultTree } from '../tree-operations';
import { ALICE, BOB, createTestService, defaultIntentHandler, getExecuteCalls } from './revfs-service-test-helpers';
import type { RevfsService } from '@/lib/revfs/revfs-service';
import type { RevfsIntent } from '@/types/revfs-intents';

// ── Tests ───────────────────────────────────────────────────────────────

describe('RevfsService', () => {
  describe('getTree', () => {
    it('creates default tree when OPFS has none', async () => {
      const service: RevfsService = createTestService(defaultIntentHandler());
      const tree: RevfsNode = await service.getTree(ALICE, BOB);

      expect(tree.path).toBe('/');
      expect(tree.children).toHaveLength(2);
      expect(tree.children![0].name).toBe('Received Files');
      expect(tree.children![1].name).toBe('Sent Files');
    });

    it('loads persisted tree from OPFS', async () => {
      const persisted: RevfsNode = createDefaultTree();
      persisted.children!.push({
        name: 'docs',
        type: 'directory',
        path: '/docs',
        children: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const service: RevfsService = createTestService(defaultIntentHandler({
        'load-tree': () => ({ type: 'load-tree', tree: persisted }),
      }));

      const tree: RevfsNode = await service.getTree(ALICE, BOB);
      expect(tree.children).toHaveLength(3);
    });

    it('caches tree on second call', async () => {
      const service: RevfsService = createTestService(defaultIntentHandler());
      await service.getTree(ALICE, BOB);
      await service.getTree(ALICE, BOB);

      const loadCalls: { type: "load-tree"; treeKey: TreeKey; }[] = getExecuteCalls(service).filter(i => i.type === 'load-tree');
      expect(loadCalls).toHaveLength(1);
    });
  });

  describe('mkdir', () => {
    it('creates directory and sends operation to peer', async () => {
      const service: RevfsService = createTestService(defaultIntentHandler());
      await service.mkdir(ALICE, BOB, '/docs');

      const intents: RevfsIntent[] = getExecuteCalls(service);
      const sendCalls: { type: "send-revfs-op"; peerCid: bigint; operation: RevfsOperation; }[] = intents.filter(i => i.type === 'send-revfs-op');

      expect(sendCalls).toHaveLength(1);
      const sentOp: RevfsOperation = (sendCalls[0] as { type: 'send-revfs-op'; operation: RevfsOperation }).operation;
      expect(sentOp.op_type).toBe(RevfsOpType.Mkdir);
      expect(sentOp.path).toBe('/docs');
    });

    it('updates tree in state after mkdir', async () => {
      const service: RevfsService = createTestService(defaultIntentHandler());
      await service.mkdir(ALICE, BOB, '/docs');

      const tree: RevfsNode = await service.getTree(ALICE, BOB);
      const docs: RevfsNode | undefined = tree.children!.find(c => c.name === 'docs');
      expect(docs).toBeDefined();
      expect(docs!.type).toBe('directory');
    });

    it('persists tree after mkdir', async () => {
      const service: RevfsService = createTestService(defaultIntentHandler());
      await service.mkdir(ALICE, BOB, '/docs');

      const persistCalls: { type: "persist-tree"; treeKey: TreeKey; tree: RevfsNode; }[] = getExecuteCalls(service).filter(i => i.type === 'persist-tree');
      expect(persistCalls.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('rmdir', () => {
    it('removes directory and sends operation', async () => {
      const service: RevfsService = createTestService(defaultIntentHandler());
      await service.mkdir(ALICE, BOB, '/docs');
      await service.rmdir(ALICE, BOB, '/docs');

      const tree: RevfsNode = await service.getTree(ALICE, BOB);
      const docs: RevfsNode | undefined = tree.children!.find(c => c.name === 'docs');
      expect(docs).toBeUndefined();
    });
  });

  describe('sendAndAwaitAck timeout', () => {
    it('queues to pendingOps when send fails', async () => {
      const service: RevfsService = createTestService(defaultIntentHandler({
        'send-revfs-op': () => ({ type: 'send-revfs-op', success: false }),
      }));

      await service.mkdir(ALICE, BOB, '/docs');

      const persistPendingCalls: { type: "persist-pending-ops"; treeKey: TreeKey; ops: RevfsPendingOp[]; }[] = getExecuteCalls(service)
        .filter(i => i.type === 'persist-pending-ops');
      expect(persistPendingCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('uploadFileToPeer', () => {
    it('places file, persists, and sends op with ACK', async () => {
      const service: RevfsService = createTestService(defaultIntentHandler());
      const meta: RevfsFileMetadata = {
        fileId: 'f1', fileName: 'doc.pdf', fileSize: 1024, fileType: 'application/pdf',
        virtualDirectory: '/vfs/doc', uploadedByCid: ALICE,
      };
      await service.uploadFileToPeer(ALICE, BOB, '/Sent Files', 'doc.pdf', meta, new Uint8Array([1, 2, 3]));

      const tree: RevfsNode = await service.getTree(ALICE, BOB);
      const file: RevfsNode | undefined = tree.children?.find(c => c.name === 'Sent Files')?.children?.find(c => c.name === 'doc.pdf');
      expect(file).toBeDefined();
      // Alice uploaded, so Bob holds the bytes and Alice's copy is Remote —
      // the state that lets her download her own file back.
      expect(file!.fileState).toBe(RevfsFileState.Remote);

      const intents: RevfsIntent[] = getExecuteCalls(service);
      expect(intents.filter(i => i.type === 'persist-tree').length).toBeGreaterThanOrEqual(2);
      expect(intents.filter(i => i.type === 'send-revfs-op').length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('removeFileFromPeer', () => {
    it('removes file, sends backend-delete-file, and sends ACK', async () => {
      const service: RevfsService = createTestService(defaultIntentHandler());
      const meta: RevfsFileMetadata = {
        fileId: 'f1', fileName: 'doc.pdf', fileSize: 1024, fileType: 'application/pdf',
        virtualDirectory: '/vfs/doc', uploadedByCid: ALICE,
      };
      await service.uploadFileToPeer(ALICE, BOB, '/Sent Files', 'doc.pdf', meta, new Uint8Array([1, 2, 3]));
      await service.removeFileFromPeer(ALICE, BOB, '/Sent Files/doc.pdf');

      const tree: RevfsNode = await service.getTree(ALICE, BOB);
      const sentFiles: RevfsNode | undefined = tree.children?.find(c => c.name === 'Sent Files');
      expect(sentFiles?.children?.find(c => c.name === 'doc.pdf')).toBeUndefined();

      const intents: RevfsIntent[] = getExecuteCalls(service);
      const deleteCalls: { type: "backend-delete-file"; cid: bigint; peerCid: bigint | null; virtualDir: string; }[] = intents.filter(i => i.type === 'backend-delete-file');
      expect(deleteCalls).toHaveLength(1);
    });
  });

  describe('downloadFileFromPeer', () => {
    it('finds file recursively and returns download path', async () => {
      const service: RevfsService = createTestService(defaultIntentHandler());
      const meta: RevfsFileMetadata = {
        fileId: 'f1', fileName: 'doc.pdf', fileSize: 1024, fileType: 'application/pdf',
        virtualDirectory: '/vfs/doc', uploadedByCid: ALICE,
      };
      await service.uploadFileToPeer(ALICE, BOB, '/Sent Files', 'doc.pdf', meta, new Uint8Array([1, 2, 3]));
      const path: string | undefined = await service.downloadFileFromPeer(ALICE, BOB, '/Sent Files/doc.pdf');
      expect(path).toBe('/tmp/file');
    });

    it('throws when file not found', async () => {
      const service: RevfsService = createTestService(defaultIntentHandler());
      await expect(service.downloadFileFromPeer(ALICE, BOB, '/nope.txt')).rejects.toThrow('File not found');
    });
  });
});
