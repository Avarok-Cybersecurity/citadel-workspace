/**
 * Tree Operations Tests: Copy & Remote Transforms
 *
 * Tests for copyNode and applyRemoteOp for Rename/Move/Copy operations.
 */

import { describe, it, expect } from 'vitest';
import {
  createDefaultTree,
  findNode,
  mkdir,
  placeFile,
  copyNode,
  applyRemoteOp,
} from '../tree-operations';
import {
  RevfsOpType,
  SENT_FILES_DIR,
} from '@/types/revfs-types';
import { CID_A, CID_B, makeMeta } from './tree-test-helpers';
import type { RevfsNode, RevfsFileMetadata } from '@/types/revfs-types';

// ============================================================================
// copyNode
// ============================================================================

describe('copyNode', () => {
  it('copies a directory to new parent', () => {
    let tree: RevfsNode = createDefaultTree();
    [tree] = mkdir(tree, '/docs');
    [tree] = mkdir(tree, '/archive');
    const [newTree, op] = copyNode(tree, '/docs', '/archive');
    expect(findNode(newTree, '/docs')).not.toBeNull();
    expect(findNode(newTree, '/archive/docs')).not.toBeNull();
    expect(op.op_type).toBe(RevfsOpType.Copy);
    expect(op.path).toBe('/docs');
    expect(op.destPath).toBe('/archive/docs');
  });

  it('copies a file to new parent', () => {
    let tree: RevfsNode = createDefaultTree();
    [tree] = mkdir(tree, '/docs');
    [tree] = mkdir(tree, '/archive');
    const meta: RevfsFileMetadata = makeMeta();
    [tree] = placeFile(tree, '/docs/report.pdf', meta, CID_A);
    let fileIdCounter: number = 0;
    const [newTree] = copyNode(tree, '/docs/report.pdf', '/archive', () => `new-id-${++fileIdCounter}`);
    expect(findNode(newTree, '/docs/report.pdf')).not.toBeNull();
    expect(findNode(newTree, '/archive/report.pdf')).not.toBeNull();
    const copiedFile: RevfsNode | null = findNode(newTree, '/archive/report.pdf');
    expect(copiedFile?.fileMetadata?.fileId).toBe('new-id-1');
  });

  it('deep copies directory with children', () => {
    let tree: RevfsNode = createDefaultTree();
    [tree] = mkdir(tree, '/docs');
    [tree] = mkdir(tree, '/docs/reports');
    [tree] = mkdir(tree, '/archive');
    const meta: RevfsFileMetadata = makeMeta();
    [tree] = placeFile(tree, '/docs/reports/q1.pdf', meta, CID_A);
    const [newTree] = copyNode(tree, '/docs', '/archive');
    expect(findNode(newTree, '/archive/docs/reports')).not.toBeNull();
    expect(findNode(newTree, '/archive/docs/reports/q1.pdf')).not.toBeNull();
  });

  it('adds (copy) suffix on name collision', () => {
    let tree: RevfsNode = createDefaultTree();
    [tree] = mkdir(tree, '/docs');
    const [newTree] = copyNode(tree, '/docs', '/');
    expect(findNode(newTree, '/docs (copy)')).not.toBeNull();
  });

  it('adds (copy 2) suffix on multiple collisions', () => {
    let tree: RevfsNode = createDefaultTree();
    [tree] = mkdir(tree, '/docs');
    [tree] = copyNode(tree, '/docs', '/');
    [tree] = copyNode(tree, '/docs', '/');
    expect(findNode(tree, '/docs (copy)')).not.toBeNull();
    expect(findNode(tree, '/docs (copy 2)')).not.toBeNull();
  });

  it('handles file extension in copy suffix', () => {
    let tree: RevfsNode = createDefaultTree();
    [tree] = mkdir(tree, '/docs');
    const meta: RevfsFileMetadata = makeMeta({ fileName: 'report.pdf' });
    [tree] = placeFile(tree, '/docs/report.pdf', meta, CID_A);
    const [newTree] = copyNode(tree, '/docs/report.pdf', '/docs');
    expect(findNode(newTree, '/docs/report (copy).pdf')).not.toBeNull();
  });

  it('throws when copying protected directory', () => {
    let tree: RevfsNode = createDefaultTree();
    [tree] = mkdir(tree, '/archive');
    expect(() => copyNode(tree, SENT_FILES_DIR, '/archive')).toThrow('protected');
  });

  it('throws when copying root', () => {
    let tree: RevfsNode = createDefaultTree();
    [tree] = mkdir(tree, '/archive');
    expect(() => copyNode(tree, '/', '/archive')).toThrow('Cannot copy root');
  });

  it('does not mutate original tree', () => {
    let tree: RevfsNode = createDefaultTree();
    [tree] = mkdir(tree, '/docs');
    [tree] = mkdir(tree, '/archive');
    const childCount: number = findNode(tree, '/archive')?.children?.length ?? 0;
    copyNode(tree, '/docs', '/archive');
    expect(findNode(tree, '/archive')?.children?.length ?? 0).toBe(childCount);
  });
});

// ============================================================================
// applyRemoteOp for Rename, Move, Copy
// ============================================================================

describe('applyRemoteOp for new operations', () => {
  it('applies remote Rename', () => {
    let tree: RevfsNode = createDefaultTree();
    [tree] = mkdir(tree, '/docs');
    const op: { op_id: string; op_type: RevfsOpType; path: string; newName: string; timestamp: number; } = { op_id: '1', op_type: RevfsOpType.Rename, path: '/docs', newName: 'documents', timestamp: Date.now() };
    const result: RevfsNode = applyRemoteOp(tree, op, CID_B);
    expect(findNode(result, '/docs')).toBeNull();
    expect(findNode(result, '/documents')).not.toBeNull();
  });

  it('applies remote Rename with nested children', () => {
    let tree: RevfsNode = createDefaultTree();
    [tree] = mkdir(tree, '/docs');
    [tree] = mkdir(tree, '/docs/reports');
    const op: { op_id: string; op_type: RevfsOpType; path: string; newName: string; timestamp: number; } = { op_id: '1', op_type: RevfsOpType.Rename, path: '/docs', newName: 'documents', timestamp: Date.now() };
    const result: RevfsNode = applyRemoteOp(tree, op, CID_B);
    expect(findNode(result, '/documents/reports')).not.toBeNull();
  });

  it('ignores remote Rename for protected dirs', () => {
    const tree: RevfsNode = createDefaultTree();
    const op: { op_id: string; op_type: RevfsOpType; path: string; newName: string; timestamp: number; } = { op_id: '1', op_type: RevfsOpType.Rename, path: SENT_FILES_DIR, newName: 'Outbox', timestamp: Date.now() };
    const result: RevfsNode = applyRemoteOp(tree, op, CID_B);
    expect(findNode(result, SENT_FILES_DIR)).not.toBeNull();
  });

  it('ignores remote Rename on collision', () => {
    let tree: RevfsNode = createDefaultTree();
    [tree] = mkdir(tree, '/docs');
    [tree] = mkdir(tree, '/files');
    const op: { op_id: string; op_type: RevfsOpType; path: string; newName: string; timestamp: number; } = { op_id: '1', op_type: RevfsOpType.Rename, path: '/docs', newName: 'files', timestamp: Date.now() };
    const result: RevfsNode = applyRemoteOp(tree, op, CID_B);
    expect(findNode(result, '/docs')).not.toBeNull();
    expect(findNode(result, '/files')).not.toBeNull();
  });

  it('applies remote Move', () => {
    let tree: RevfsNode = createDefaultTree();
    [tree] = mkdir(tree, '/docs');
    [tree] = mkdir(tree, '/archive');
    const op: { op_id: string; op_type: RevfsOpType; path: string; destPath: string; timestamp: number; } = { op_id: '1', op_type: RevfsOpType.Move, path: '/docs', destPath: '/archive/docs', timestamp: Date.now() };
    const result: RevfsNode = applyRemoteOp(tree, op, CID_B);
    expect(findNode(result, '/docs')).toBeNull();
    expect(findNode(result, '/archive/docs')).not.toBeNull();
  });

  it('applies remote Move with nested children', () => {
    let tree: RevfsNode = createDefaultTree();
    [tree] = mkdir(tree, '/docs');
    [tree] = mkdir(tree, '/docs/reports');
    [tree] = mkdir(tree, '/archive');
    const op: { op_id: string; op_type: RevfsOpType; path: string; destPath: string; timestamp: number; } = { op_id: '1', op_type: RevfsOpType.Move, path: '/docs', destPath: '/archive/docs', timestamp: Date.now() };
    const result: RevfsNode = applyRemoteOp(tree, op, CID_B);
    expect(findNode(result, '/archive/docs/reports')).not.toBeNull();
  });

  it('ignores remote Move for protected dirs', () => {
    let tree: RevfsNode = createDefaultTree();
    [tree] = mkdir(tree, '/archive');
    const op: { op_id: string; op_type: RevfsOpType; path: string; destPath: string; timestamp: number; } = { op_id: '1', op_type: RevfsOpType.Move, path: SENT_FILES_DIR, destPath: '/archive/sent', timestamp: Date.now() };
    const result: RevfsNode = applyRemoteOp(tree, op, CID_B);
    expect(findNode(result, SENT_FILES_DIR)).not.toBeNull();
  });

  it('applies remote Copy', () => {
    let tree: RevfsNode = createDefaultTree();
    [tree] = mkdir(tree, '/docs');
    [tree] = mkdir(tree, '/archive');
    const op: { op_id: string; op_type: RevfsOpType; path: string; destPath: string; timestamp: number; } = { op_id: '1', op_type: RevfsOpType.Copy, path: '/docs', destPath: '/archive/docs', timestamp: Date.now() };
    const result: RevfsNode = applyRemoteOp(tree, op, CID_B);
    expect(findNode(result, '/docs')).not.toBeNull();
    expect(findNode(result, '/archive/docs')).not.toBeNull();
  });

  it('applies remote Copy with metadata', () => {
    let tree: RevfsNode = createDefaultTree();
    [tree] = mkdir(tree, '/docs');
    [tree] = mkdir(tree, '/archive');
    const meta: RevfsFileMetadata = makeMeta({ fileId: 'original' });
    [tree] = placeFile(tree, '/docs/report.pdf', meta, CID_A);
    const newMeta: RevfsFileMetadata = makeMeta({ fileId: 'copied' });
    const op: { op_id: string; op_type: RevfsOpType; path: string; destPath: string; metadata: RevfsFileMetadata; timestamp: number; } = { op_id: '1', op_type: RevfsOpType.Copy, path: '/docs/report.pdf', destPath: '/archive/report.pdf', metadata: newMeta, timestamp: Date.now() };
    const result: RevfsNode = applyRemoteOp(tree, op, CID_B);
    const copiedFile: RevfsNode | null = findNode(result, '/archive/report.pdf');
    expect(copiedFile?.fileMetadata?.fileId).toBe('copied');
  });

  it('ignores remote Copy on collision', () => {
    let tree: RevfsNode = createDefaultTree();
    [tree] = mkdir(tree, '/docs');
    [tree] = mkdir(tree, '/archive');
    [tree] = mkdir(tree, '/archive/docs');
    const op: { op_id: string; op_type: RevfsOpType; path: string; destPath: string; timestamp: number; } = { op_id: '1', op_type: RevfsOpType.Copy, path: '/docs', destPath: '/archive/docs', timestamp: Date.now() };
    const result: RevfsNode = applyRemoteOp(tree, op, CID_B);
    const archiveDocs: RevfsNode | null = findNode(result, '/archive/docs');
    expect(archiveDocs?.children?.length ?? 0).toBe(0);
  });
});
