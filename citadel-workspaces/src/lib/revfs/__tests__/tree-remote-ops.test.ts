/**
 * Tree Operations Tests: Remote Operations & Merge
 *
 * Tests for applyRemoteOp (basic ops) and mergeTrees.
 */

import { describe, it, expect } from 'vitest';
import {
  createDefaultTree,
  findNode,
  mkdir,
  placeFile,
  applyRemoteOp,
  mergeTrees,
} from '../tree-operations';
import {
  RevfsFileState,
  RevfsOpType,
  SENT_FILES_DIR,
} from '@/types/revfs-types';
import type { RevfsNode, RevfsFileMetadata } from '@/types/revfs-types';
import { CID_A, CID_B, makeMeta } from './tree-test-helpers';

// ============================================================================
// applyRemoteOp
// ============================================================================

describe('applyRemoteOp', () => {
  it('applies remote mkdir idempotently', () => {
    const tree: RevfsNode = createDefaultTree();
    const op: { op_id: string; op_type: RevfsOpType; path: string; timestamp: number; } = { op_id: '1', op_type: RevfsOpType.Mkdir, path: '/shared', timestamp: Date.now() };
    const result: RevfsNode = applyRemoteOp(tree, op, CID_B);
    expect(findNode(result, '/shared')).not.toBeNull();
    const result2: RevfsNode = applyRemoteOp(result, op, CID_B);
    expect(findNode(result2, '/shared')).not.toBeNull();
  });

  it('applies remote rmdir', () => {
    let tree: RevfsNode = createDefaultTree();
    [tree] = mkdir(tree, '/tmp');
    const op: { op_id: string; op_type: RevfsOpType; path: string; timestamp: number; } = { op_id: '1', op_type: RevfsOpType.Rmdir, path: '/tmp', timestamp: Date.now() };
    const result: RevfsNode = applyRemoteOp(tree, op, CID_B);
    expect(findNode(result, '/tmp')).toBeNull();
  });

  it('does not remove protected dirs via remote op', () => {
    const tree: RevfsNode = createDefaultTree();
    const op: { op_id: string; op_type: RevfsOpType; path: string; timestamp: number; } = { op_id: '1', op_type: RevfsOpType.Rmdir, path: SENT_FILES_DIR, timestamp: Date.now() };
    const result: RevfsNode = applyRemoteOp(tree, op, CID_B);
    expect(findNode(result, SENT_FILES_DIR)).not.toBeNull();
  });

  it('applies remote placeFile with flipped state', () => {
    let tree: RevfsNode = createDefaultTree();
    [tree] = mkdir(tree, '/docs');
    const meta: RevfsFileMetadata = makeMeta({ uploadedByCid: CID_A });
    const op: { op_id: string; op_type: RevfsOpType; path: string; metadata: RevfsFileMetadata; timestamp: number; } = {
      op_id: '1', op_type: RevfsOpType.PlaceFile, path: '/docs/file.pdf',
      metadata: meta, timestamp: Date.now(),
    };
    const result: RevfsNode = applyRemoteOp(tree, op, CID_B);
    const file: RevfsNode | null = findNode(result, '/docs/file.pdf');
    expect(file).not.toBeNull();
    // A uploaded, so the bytes travelled to B: B is the one HOSTING them.
    // This expected Remote, encoding the inversion that made an uploader's own
    // file un-downloadable. See placeFile in tree-mutations.ts.
    expect(file!.fileState).toBe(RevfsFileState.Hosted);
  });

  it('applies remote RemoveFile', () => {
    let tree: RevfsNode = createDefaultTree();
    [tree] = mkdir(tree, '/docs');
    const meta: RevfsFileMetadata = makeMeta();
    [tree] = placeFile(tree, '/docs/test.pdf', meta, CID_A);
    const op: { op_id: string; op_type: RevfsOpType; path: string; timestamp: number; } = { op_id: '1', op_type: RevfsOpType.RemoveFile, path: '/docs/test.pdf', timestamp: Date.now() };
    const result: RevfsNode = applyRemoteOp(tree, op, CID_B);
    expect(findNode(result, '/docs/test.pdf')).toBeNull();
  });

  it('returns tree unchanged for RemoveFile on missing file', () => {
    const tree: RevfsNode = createDefaultTree();
    const op: { op_id: string; op_type: RevfsOpType; path: string; timestamp: number; } = { op_id: '1', op_type: RevfsOpType.RemoveFile, path: '/nope.txt', timestamp: Date.now() };
    const result: RevfsNode = applyRemoteOp(tree, op, CID_B);
    expect(result.children).toHaveLength(2);
  });

  it('applies SyncResponse with flipped file states', () => {
    let remoteTree: RevfsNode = createDefaultTree();
    [remoteTree] = mkdir(remoteTree, '/docs');
    const meta: RevfsFileMetadata = makeMeta({ uploadedByCid: CID_A });
    [remoteTree] = placeFile(remoteTree, '/docs/test.pdf', meta, CID_A);
    // A uploaded it, so from A's side the blob lives on the peer: Remote.
    expect(findNode(remoteTree, '/docs/test.pdf')!.fileState).toBe(RevfsFileState.Remote);

    const op: { op_id: string; op_type: RevfsOpType; path: string; tree: RevfsNode; timestamp: number; } = {
      op_id: '1', op_type: RevfsOpType.SyncResponse, path: '/',
      tree: remoteTree, timestamp: Date.now(),
    };
    const result: RevfsNode = applyRemoteOp(createDefaultTree(), op, CID_B);
    const file: RevfsNode | null = findNode(result, '/docs/test.pdf');
    expect(file).not.toBeNull();
    // ...and flipping to B's perspective makes it Hosted, since B holds it.
    expect(file!.fileState).toBe(RevfsFileState.Hosted);
  });

  it('returns tree unchanged for SyncResponse with null tree', () => {
    const tree: RevfsNode = createDefaultTree();
    const op: { op_id: string; op_type: RevfsOpType; path: string; timestamp: number; } = { op_id: '1', op_type: RevfsOpType.SyncResponse, path: '/', timestamp: Date.now() };
    const result: RevfsNode = applyRemoteOp(tree, op, CID_B);
    expect(result.children).toHaveLength(2);
  });

  it('returns tree unchanged for PlaceFile without metadata', () => {
    let tree: RevfsNode = createDefaultTree();
    [tree] = mkdir(tree, '/docs');
    const op: { op_id: string; op_type: RevfsOpType; path: string; timestamp: number; } = { op_id: '1', op_type: RevfsOpType.PlaceFile, path: '/docs/f.txt', timestamp: Date.now() };
    const result: RevfsNode = applyRemoteOp(tree, op, CID_B);
    expect(findNode(result, '/docs/f.txt')).toBeNull();
  });

  it('replaces existing file via remote PlaceFile', () => {
    let tree: RevfsNode = createDefaultTree();
    [tree] = mkdir(tree, '/docs');
    const meta1: RevfsFileMetadata = makeMeta({ fileId: 'v1', uploadedByCid: CID_A });
    const op1: { op_id: string; op_type: RevfsOpType; path: string; metadata: RevfsFileMetadata; timestamp: number; } = { op_id: '1', op_type: RevfsOpType.PlaceFile, path: '/docs/f.pdf', metadata: meta1, timestamp: Date.now() };
    tree = applyRemoteOp(tree, op1, CID_B);
    const meta2: RevfsFileMetadata = makeMeta({ fileId: 'v2', uploadedByCid: CID_A });
    const op2: { op_id: string; op_type: RevfsOpType; path: string; metadata: RevfsFileMetadata; timestamp: number; } = { op_id: '2', op_type: RevfsOpType.PlaceFile, path: '/docs/f.pdf', metadata: meta2, timestamp: Date.now() };
    tree = applyRemoteOp(tree, op2, CID_B);
    const file: RevfsNode | null = findNode(tree, '/docs/f.pdf');
    expect(file!.fileMetadata!.fileId).toBe('v2');
    expect(findNode(tree, '/docs')!.children!.filter(c => c.type === 'file')).toHaveLength(1);
  });

  it('returns tree unchanged for Rmdir on non-existent path', () => {
    const tree: RevfsNode = createDefaultTree();
    const op: { op_id: string; op_type: RevfsOpType; path: string; timestamp: number; } = { op_id: '1', op_type: RevfsOpType.Rmdir, path: '/nope', timestamp: Date.now() };
    const result: RevfsNode = applyRemoteOp(tree, op, CID_B);
    expect(result.children).toHaveLength(2);
  });

  it('returns tree unchanged for Mkdir with missing parent', () => {
    const tree: RevfsNode = createDefaultTree();
    const op: { op_id: string; op_type: RevfsOpType; path: string; timestamp: number; } = { op_id: '1', op_type: RevfsOpType.Mkdir, path: '/a/b', timestamp: Date.now() };
    const result: RevfsNode = applyRemoteOp(tree, op, CID_B);
    expect(findNode(result, '/a/b')).toBeNull();
  });

  it('SyncResponse flips nested states recursively (Sent/Received unchanged)', () => {
    let remoteTree: RevfsNode = createDefaultTree();
    [remoteTree] = mkdir(remoteTree, '/mix');
    const mixNode: RevfsNode = findNode(remoteTree, '/mix')!;
    mixNode.children = [
      { name: 'hosted.txt', type: 'file', path: '/mix/hosted.txt', fileState: RevfsFileState.Hosted, createdAt: 1, updatedAt: 1 },
      { name: 'remote.txt', type: 'file', path: '/mix/remote.txt', fileState: RevfsFileState.Remote, createdAt: 1, updatedAt: 1 },
      { name: 'sent.txt', type: 'file', path: '/mix/sent.txt', fileState: RevfsFileState.Sent, createdAt: 1, updatedAt: 1 },
      { name: 'recv.txt', type: 'file', path: '/mix/recv.txt', fileState: RevfsFileState.Received, createdAt: 1, updatedAt: 1 },
    ];

    const op: { op_id: string; op_type: RevfsOpType; path: string; tree: RevfsNode; timestamp: number; } = { op_id: '1', op_type: RevfsOpType.SyncResponse, path: '/', tree: remoteTree, timestamp: Date.now() };
    const result: RevfsNode = applyRemoteOp(createDefaultTree(), op, CID_B);
    expect(findNode(result, '/mix/hosted.txt')!.fileState).toBe(RevfsFileState.Remote);
    expect(findNode(result, '/mix/remote.txt')!.fileState).toBe(RevfsFileState.Hosted);
    expect(findNode(result, '/mix/sent.txt')!.fileState).toBe(RevfsFileState.Sent);
    expect(findNode(result, '/mix/recv.txt')!.fileState).toBe(RevfsFileState.Received);
  });
});

// ============================================================================
// mergeTrees
// ============================================================================

describe('mergeTrees', () => {
  it('merges disjoint directories', () => {
    let local: RevfsNode = createDefaultTree();
    [local] = mkdir(local, '/local-only');
    let remote: RevfsNode = createDefaultTree();
    [remote] = mkdir(remote, '/remote-only');
    const merged: RevfsNode = mergeTrees(local, remote);
    expect(findNode(merged, '/local-only')).not.toBeNull();
    expect(findNode(merged, '/remote-only')).not.toBeNull();
  });

  it('keeps later-updated node on conflict', () => {
    const base: RevfsNode = createDefaultTree();
    const local: { updatedAt: number; name: string; type: "file" | "directory"; path: string; children?: RevfsNode[]; fileState?: RevfsFileState; fileMetadata?: RevfsFileMetadata; createdAt: number; } = { ...base, updatedAt: 1000 };
    const remote: { updatedAt: number; name: string; type: "file" | "directory"; path: string; children?: RevfsNode[]; fileState?: RevfsFileState; fileMetadata?: RevfsFileMetadata; createdAt: number; } = { ...base, updatedAt: 2000 };
    const merged: RevfsNode = mergeTrees(local, remote);
    expect(merged.updatedAt).toBe(2000);
  });

  it('file-vs-file conflict uses later updatedAt', () => {
    const localFile: RevfsNode = { name: 'f.txt', type: 'file', path: '/f.txt', createdAt: 1, updatedAt: 100, fileMetadata: makeMeta({ fileId: 'local' }) };
    const remoteFile: RevfsNode = { name: 'f.txt', type: 'file', path: '/f.txt', createdAt: 1, updatedAt: 200, fileMetadata: makeMeta({ fileId: 'remote' }) };
    const merged: RevfsNode = mergeTrees(localFile, remoteFile);
    expect(merged.fileMetadata!.fileId).toBe('remote');
  });

  it('merges nested directories recursively', () => {
    let local: RevfsNode = createDefaultTree();
    [local] = mkdir(local, '/shared');
    [local] = mkdir(local, '/shared/a');
    let remote: RevfsNode = createDefaultTree();
    [remote] = mkdir(remote, '/shared');
    [remote] = mkdir(remote, '/shared/b');
    const merged: RevfsNode = mergeTrees(local, remote);
    expect(findNode(merged, '/shared/a')).not.toBeNull();
    expect(findNode(merged, '/shared/b')).not.toBeNull();
  });

  it('adds remote-only nested children', () => {
    const local: RevfsNode = createDefaultTree();
    let remote: RevfsNode = createDefaultTree();
    [remote] = mkdir(remote, '/newdir');
    [remote] = mkdir(remote, '/newdir/sub');
    const merged: RevfsNode = mergeTrees(local, remote);
    expect(findNode(merged, '/newdir')).not.toBeNull();
    expect(findNode(merged, '/newdir/sub')).not.toBeNull();
  });
});
