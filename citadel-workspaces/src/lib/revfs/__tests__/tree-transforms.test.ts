/**
 * Tree Operations Tests: Transforms
 *
 * Tests for renameNode, moveNode, copyNode, and applyRemoteOp for
 * Rename/Move/Copy operations.
 */

import { describe, it, expect } from 'vitest';
import {
  createDefaultTree,
  findNode,
  mkdir,
  placeFile,
  renameNode,
  moveNode,
} from '../tree-operations';
import {
  RevfsOpType,
  SENT_FILES_DIR,
  RECEIVED_FILES_DIR,
} from '@/types/revfs-types';
import { CID_A, makeMeta } from './tree-test-helpers';
import type { RevfsNode, RevfsFileMetadata } from '@/types/revfs-types';

// ============================================================================
// renameNode
// ============================================================================

describe('renameNode', () => {
  it('renames a directory', () => {
    let tree: RevfsNode = createDefaultTree();
    [tree] = mkdir(tree, '/docs');
    const [newTree, op] = renameNode(tree, '/docs', 'documents');
    expect(findNode(newTree, '/docs')).toBeNull();
    expect(findNode(newTree, '/documents')).not.toBeNull();
    expect(op.op_type).toBe(RevfsOpType.Rename);
    expect(op.path).toBe('/docs');
    expect(op.newName).toBe('documents');
  });

  it('renames a file', () => {
    let tree: RevfsNode = createDefaultTree();
    [tree] = mkdir(tree, '/docs');
    const meta: RevfsFileMetadata = makeMeta({ fileName: 'old.pdf' });
    [tree] = placeFile(tree, '/docs/old.pdf', meta, CID_A);
    const [newTree, op] = renameNode(tree, '/docs/old.pdf', 'new.pdf');
    expect(findNode(newTree, '/docs/old.pdf')).toBeNull();
    expect(findNode(newTree, '/docs/new.pdf')).not.toBeNull();
    expect(op.newName).toBe('new.pdf');
  });

  it('updates child paths when renaming directory', () => {
    let tree: RevfsNode = createDefaultTree();
    [tree] = mkdir(tree, '/docs');
    [tree] = mkdir(tree, '/docs/reports');
    const meta: RevfsFileMetadata = makeMeta();
    [tree] = placeFile(tree, '/docs/reports/q1.pdf', meta, CID_A);
    const [newTree] = renameNode(tree, '/docs', 'documents');
    expect(findNode(newTree, '/documents/reports')).not.toBeNull();
    expect(findNode(newTree, '/documents/reports/q1.pdf')).not.toBeNull();
  });

  it('throws on root rename', () => {
    const tree: RevfsNode = createDefaultTree();
    expect(() => renameNode(tree, '/', 'newroot')).toThrow('Cannot rename root');
  });

  it('throws on protected directory rename', () => {
    const tree: RevfsNode = createDefaultTree();
    expect(() => renameNode(tree, SENT_FILES_DIR, 'Outbox')).toThrow('protected');
    expect(() => renameNode(tree, RECEIVED_FILES_DIR, 'Inbox')).toThrow('protected');
  });

  it('throws on name collision', () => {
    let tree: RevfsNode = createDefaultTree();
    [tree] = mkdir(tree, '/docs');
    [tree] = mkdir(tree, '/files');
    expect(() => renameNode(tree, '/docs', 'files')).toThrow('already exists');
  });

  it('throws on invalid name', () => {
    let tree: RevfsNode = createDefaultTree();
    [tree] = mkdir(tree, '/docs');
    expect(() => renameNode(tree, '/docs', '')).toThrow('Invalid name');
    expect(() => renameNode(tree, '/docs', 'path/with/slash')).toThrow('Invalid name');
  });

  it('does not mutate original tree', () => {
    let tree: RevfsNode = createDefaultTree();
    [tree] = mkdir(tree, '/docs');
    renameNode(tree, '/docs', 'documents');
    expect(findNode(tree, '/docs')).not.toBeNull();
    expect(findNode(tree, '/documents')).toBeNull();
  });
});

// ============================================================================
// moveNode
// ============================================================================

describe('moveNode', () => {
  it('moves a directory to new parent', () => {
    let tree: RevfsNode = createDefaultTree();
    [tree] = mkdir(tree, '/docs');
    [tree] = mkdir(tree, '/archive');
    const [newTree, op] = moveNode(tree, '/docs', '/archive');
    expect(findNode(newTree, '/docs')).toBeNull();
    expect(findNode(newTree, '/archive/docs')).not.toBeNull();
    expect(op.op_type).toBe(RevfsOpType.Move);
    expect(op.path).toBe('/docs');
    expect(op.destPath).toBe('/archive/docs');
  });

  it('moves a file to new parent', () => {
    let tree: RevfsNode = createDefaultTree();
    [tree] = mkdir(tree, '/docs');
    [tree] = mkdir(tree, '/archive');
    const meta: RevfsFileMetadata = makeMeta();
    [tree] = placeFile(tree, '/docs/report.pdf', meta, CID_A);
    const [newTree] = moveNode(tree, '/docs/report.pdf', '/archive');
    expect(findNode(newTree, '/docs/report.pdf')).toBeNull();
    expect(findNode(newTree, '/archive/report.pdf')).not.toBeNull();
  });

  it('updates child paths when moving directory', () => {
    let tree: RevfsNode = createDefaultTree();
    [tree] = mkdir(tree, '/docs');
    [tree] = mkdir(tree, '/docs/reports');
    [tree] = mkdir(tree, '/archive');
    const meta: RevfsFileMetadata = makeMeta();
    [tree] = placeFile(tree, '/docs/reports/q1.pdf', meta, CID_A);
    const [newTree] = moveNode(tree, '/docs', '/archive');
    expect(findNode(newTree, '/archive/docs/reports')).not.toBeNull();
    expect(findNode(newTree, '/archive/docs/reports/q1.pdf')).not.toBeNull();
  });

  it('throws when moving to root', () => {
    const tree: RevfsNode = createDefaultTree();
    expect(() => moveNode(tree, '/', '/somewhere')).toThrow('Cannot move root');
  });

  it('throws when moving protected directory', () => {
    let tree: RevfsNode = createDefaultTree();
    [tree] = mkdir(tree, '/archive');
    expect(() => moveNode(tree, SENT_FILES_DIR, '/archive')).toThrow('protected');
  });

  it('throws when moving into itself', () => {
    let tree: RevfsNode = createDefaultTree();
    [tree] = mkdir(tree, '/docs');
    [tree] = mkdir(tree, '/docs/sub');
    expect(() => moveNode(tree, '/docs', '/docs')).toThrow('into itself');
    expect(() => moveNode(tree, '/docs', '/docs/sub')).toThrow('into itself');
  });

  it('throws on name collision at destination', () => {
    let tree: RevfsNode = createDefaultTree();
    [tree] = mkdir(tree, '/docs');
    [tree] = mkdir(tree, '/archive');
    [tree] = mkdir(tree, '/archive/docs');
    expect(() => moveNode(tree, '/docs', '/archive')).toThrow('already exists');
  });

  it('does not mutate original tree', () => {
    let tree: RevfsNode = createDefaultTree();
    [tree] = mkdir(tree, '/docs');
    [tree] = mkdir(tree, '/archive');
    moveNode(tree, '/docs', '/archive');
    expect(findNode(tree, '/docs')).not.toBeNull();
    expect(findNode(tree, '/archive/docs')).toBeNull();
  });
});

describe('rebasePath under names containing $', () => {
  it('does not let a $ sequence in the new name rewrite descendant paths', () => {
    let tree: RevfsNode = createDefaultTree();
    [tree] = mkdir(tree, '/reports');
    [tree] = mkdir(tree, '/reports/inner');

    // `$$` is a legal folder name — VFSRenameInput only rejects "." and "..".
    // With String.replace it was interpreted as an escape in the REPLACEMENT,
    // so descendants got `cost$report` while the node was named `cost$$report`:
    // findNode then missed every child and those files became unreachable.
    const [renamed] = renameNode(tree, '/reports', 'cost$$report');

    expect(findNode(renamed, '/cost$$report')).not.toBeNull();
    expect(findNode(renamed, '/cost$$report/inner')).not.toBeNull();
    expect(findNode(renamed, '/cost$report/inner')).toBeNull();
  });

  it('survives the other replacement patterns too', () => {
    for (const name of ['a$&b', "a$'b", 'a$`b']) {
      let tree: RevfsNode = createDefaultTree();
      [tree] = mkdir(tree, '/src');
      [tree] = mkdir(tree, '/src/child');

      const [renamed] = renameNode(tree, '/src', name);
      expect(findNode(renamed, `/${name}/child`)).not.toBeNull();
    }
  });
});
