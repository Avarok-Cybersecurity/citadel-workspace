/**
 * Tree Operations Tests: Mutations
 *
 * Tests for mkdir, rmdir, placeFile, removeFile, flipFileState.
 */

import { describe, it, expect } from 'vitest';
import {
  createDefaultTree,
  findNode,
  mkdir,
  rmdir,
  placeFile,
  removeFile,
  flipFileState,
} from '../tree-operations';
import {
  RevfsFileState,
  RevfsOpType,
  SENT_FILES_DIR,
  RECEIVED_FILES_DIR,
} from '@/types/revfs-types';
import { CID_A, CID_B, makeMeta } from './tree-test-helpers';
import type { RevfsNode, RevfsFileMetadata } from '@/types/revfs-types';

// ============================================================================
// mkdir
// ============================================================================

describe('mkdir', () => {
  it('creates a directory under root', () => {
    const tree: RevfsNode = createDefaultTree();
    const [newTree, op] = mkdir(tree, '/shared');
    expect(findNode(newTree, '/shared')).not.toBeNull();
    expect(op.op_type).toBe(RevfsOpType.Mkdir);
    expect(op.path).toBe('/shared');
  });

  it('creates nested directory', () => {
    let tree: RevfsNode = createDefaultTree();
    [tree] = mkdir(tree, '/docs');
    [tree] = mkdir(tree, '/docs/reports');
    expect(findNode(tree, '/docs/reports')).not.toBeNull();
  });

  it('throws if parent missing', () => {
    const tree: RevfsNode = createDefaultTree();
    expect(() => mkdir(tree, '/a/b')).toThrow('Parent directory not found');
  });

  it('throws if already exists', () => {
    const tree: RevfsNode = createDefaultTree();
    const [newTree] = mkdir(tree, '/test');
    expect(() => mkdir(newTree, '/test')).toThrow('already exists');
  });

  it('does not mutate original tree', () => {
    const tree: RevfsNode = createDefaultTree();
    const childCount: number = tree.children!.length;
    mkdir(tree, '/new');
    expect(tree.children!.length).toBe(childCount);
  });
});

// ============================================================================
// rmdir
// ============================================================================

describe('rmdir', () => {
  it('removes a directory', () => {
    let tree: RevfsNode = createDefaultTree();
    [tree] = mkdir(tree, '/tmp');
    expect(findNode(tree, '/tmp')).not.toBeNull();
    const [newTree, op] = rmdir(tree, '/tmp');
    expect(findNode(newTree, '/tmp')).toBeNull();
    expect(op.op_type).toBe(RevfsOpType.Rmdir);
  });

  it('throws on protected directory', () => {
    const tree: RevfsNode = createDefaultTree();
    expect(() => rmdir(tree, SENT_FILES_DIR)).toThrow('protected');
    expect(() => rmdir(tree, RECEIVED_FILES_DIR)).toThrow('protected');
  });

  it('throws on root', () => {
    const tree: RevfsNode = createDefaultTree();
    expect(() => rmdir(tree, '/')).toThrow('root');
  });

  it('throws if not found', () => {
    const tree: RevfsNode = createDefaultTree();
    expect(() => rmdir(tree, '/nonexistent')).toThrow('not found');
  });

  it('throws on file path', () => {
    let tree: RevfsNode = createDefaultTree();
    [tree] = mkdir(tree, '/docs');
    const meta: RevfsFileMetadata = makeMeta();
    [tree] = placeFile(tree, '/docs/test.pdf', meta, CID_A);
    expect(() => rmdir(tree, '/docs/test.pdf')).toThrow('Not a directory');
  });
});

// ============================================================================
// placeFile
// ============================================================================

describe('placeFile', () => {
  it('places file with Remote state when viewer uploaded', () => {
    let tree: RevfsNode = createDefaultTree();
    [tree] = mkdir(tree, '/docs');
    const meta: RevfsFileMetadata = makeMeta({ uploadedByCid: CID_A });
    const [newTree, op] = placeFile(tree, '/docs/test.pdf', meta, CID_A);
    const file: RevfsNode | null = findNode(newTree, '/docs/test.pdf');
    expect(file).not.toBeNull();
    // The uploader sent the bytes AWAY, so the peer holds them. Remote is also
    // the only state the download handler accepts, and downloadFileFromPeer
    // pulls FROM the peer — so this is what makes an uploader able to retrieve
    // their own file. These tests expected Hosted, encoding the inversion.
    expect(file!.fileState).toBe(RevfsFileState.Remote);
    expect(op.op_type).toBe(RevfsOpType.PlaceFile);
  });

  it('places file with Hosted state when peer uploaded', () => {
    let tree: RevfsNode = createDefaultTree();
    [tree] = mkdir(tree, '/docs');
    const meta: RevfsFileMetadata = makeMeta({ uploadedByCid: CID_A });
    const [newTree] = placeFile(tree, '/docs/test.pdf', meta, CID_B);
    const file: RevfsNode | null = findNode(newTree, '/docs/test.pdf');
    expect(file!.fileState).toBe(RevfsFileState.Hosted);
  });

  it('throws on missing parent', () => {
    const tree: RevfsNode = createDefaultTree();
    expect(() => placeFile(tree, '/nope/test.pdf', makeMeta(), CID_A)).toThrow('Parent directory not found');
  });

  it('replaces existing file at same path', () => {
    let tree: RevfsNode = createDefaultTree();
    [tree] = mkdir(tree, '/docs');
    const meta1: RevfsFileMetadata = makeMeta({ fileId: 'v1', uploadedByCid: CID_A });
    [tree] = placeFile(tree, '/docs/test.pdf', meta1, CID_A);
    const meta2: RevfsFileMetadata = makeMeta({ fileId: 'v2', uploadedByCid: CID_A });
    [tree] = placeFile(tree, '/docs/test.pdf', meta2, CID_A);
    const file: RevfsNode | null = findNode(tree, '/docs/test.pdf');
    expect(file!.fileMetadata!.fileId).toBe('v2');
    const docs: RevfsNode | null = findNode(tree, '/docs');
    expect(docs!.children!.filter(c => c.type === 'file')).toHaveLength(1);
  });
});

// ============================================================================
// removeFile
// ============================================================================

describe('removeFile', () => {
  it('removes a file', () => {
    let tree: RevfsNode = createDefaultTree();
    [tree] = mkdir(tree, '/docs');
    const meta: RevfsFileMetadata = makeMeta();
    [tree] = placeFile(tree, '/docs/test.pdf', meta, CID_A);
    const [newTree, op] = removeFile(tree, '/docs/test.pdf');
    expect(findNode(newTree, '/docs/test.pdf')).toBeNull();
    expect(op.op_type).toBe(RevfsOpType.RemoveFile);
  });

  it('throws if file not found', () => {
    const tree: RevfsNode = createDefaultTree();
    expect(() => removeFile(tree, '/nope.txt')).toThrow('not found');
  });

  it('throws on directory path', () => {
    let tree: RevfsNode = createDefaultTree();
    [tree] = mkdir(tree, '/docs');
    expect(() => removeFile(tree, '/docs')).toThrow('Not a file');
  });
});

// ============================================================================
// flipFileState
// ============================================================================

describe('flipFileState', () => {
  it('flips Hosted to Remote', () => {
    expect(flipFileState(RevfsFileState.Hosted)).toBe(RevfsFileState.Remote);
  });
  it('flips Remote to Hosted', () => {
    expect(flipFileState(RevfsFileState.Remote)).toBe(RevfsFileState.Hosted);
  });
  it('leaves Sent unchanged', () => {
    expect(flipFileState(RevfsFileState.Sent)).toBe(RevfsFileState.Sent);
  });
  it('leaves Received unchanged', () => {
    expect(flipFileState(RevfsFileState.Received)).toBe(RevfsFileState.Received);
  });
});
