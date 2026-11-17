/**
 * Tree Operations Tests: Deep Nested Stress Tests
 *
 * Tests for deeply nested tree structures, wide trees, immutability,
 * and path normalization at depth.
 */

import { describe, it, expect } from 'vitest';
import {
  createDefaultTree,
  findNode,
  mkdir,
  rmdir,
  placeFile,
  removeFile,
  applyRemoteOp,
  mergeTrees,
} from '../tree-operations';
import {
  RevfsFileState,
  RevfsOpType,
} from '@/types/revfs-types';
import type { RevfsNode, RevfsFileMetadata } from '@/types/revfs-types';
import { CID_A, CID_B, makeMeta } from './tree-test-helpers';

// ============================================================================
// Helpers
// ============================================================================

const MAX_DEPTH: number = 50;
const FILES_PER_LEVEL: number = 3;

function buildPathAtDepth(depth: number): string {
  if (depth === 0) return '/';
  const segments: string[] = Array.from({ length: depth }, (_, i) => `level-${i}`);
  return '/' + segments.join('/');
}

function createDeepTree(depth: number, filesPerLevel: number): {
  tree: RevfsNode;
  allDirPaths: string[];
  allFilePaths: string[];
  totalDirs: number;
  totalFiles: number;
} {
  let tree: RevfsNode = createDefaultTree();
  const allDirPaths: string[] = [];
  const allFilePaths: string[] = [];

  for (let d: number = 1; d <= depth; d++) {
    const parentPath: string = buildPathAtDepth(d - 1);
    const dirName: string = `level-${d - 1}`;
    const dirPath: string = parentPath === '/' ? `/${dirName}` : `${parentPath}/${dirName}`;
    [tree] = mkdir(tree, dirPath);
    allDirPaths.push(dirPath);

    for (let f: number = 0; f < filesPerLevel; f++) {
      const fileName: string = `file-${d}-${f}.dat`;
      const filePath: string = `${dirPath}/${fileName}`;
      const meta: RevfsFileMetadata = makeMeta({
        fileId: `file-${d}-${f}`,
        fileName,
        fileSize: (d * 1000) + (f * 100),
        uploadedByCid: f % 2 === 0 ? CID_A : CID_B,
      });
      [tree] = placeFile(tree, filePath, meta, CID_A);
      allFilePaths.push(filePath);
    }
  }

  return { tree, allDirPaths, allFilePaths, totalDirs: depth, totalFiles: depth * filesPerLevel };
}

function countNodes(node: RevfsNode): { dirs: number; files: number } {
  let dirs: number = node.type === 'directory' ? 1 : 0;
  let files: number = node.type === 'file' ? 1 : 0;
  for (const child of node.children ?? []) {
    const childCounts: { dirs: number; files: number; } = countNodes(child);
    dirs += childCounts.dirs;
    files += childCounts.files;
  }
  return { dirs, files };
}

function calculateMaxDepth(node: RevfsNode, currentDepth: number = 0): number {
  if (!node.children || node.children.length === 0) {
    return currentDepth;
  }
  return Math.max(...node.children.map(c => calculateMaxDepth(c, currentDepth + 1)));
}

// ============================================================================
// Deep Nested Tree Stress Tests
// ============================================================================

describe('deep nested tree stress tests', () => {
  it('creates deeply nested tree with files at each level (50 levels)', () => {
    const { tree, allDirPaths, allFilePaths, totalDirs, totalFiles } = createDeepTree(MAX_DEPTH, FILES_PER_LEVEL);
    expect(allDirPaths).toHaveLength(totalDirs);
    expect(allFilePaths).toHaveLength(totalFiles);

    for (const dirPath of allDirPaths) {
      const node: RevfsNode | null = findNode(tree, dirPath);
      expect(node).not.toBeNull();
      expect(node!.type).toBe('directory');
    }

    for (const filePath of allFilePaths) {
      const node: RevfsNode | null = findNode(tree, filePath);
      expect(node).not.toBeNull();
      expect(node!.type).toBe('file');
      expect(node!.fileMetadata).toBeDefined();
    }
  });

  it('finds deepest node efficiently', () => {
    const { tree, allDirPaths } = createDeepTree(MAX_DEPTH, FILES_PER_LEVEL);
    const deepestPath: string = allDirPaths[allDirPaths.length - 1];
    const deepNode: RevfsNode | null = findNode(tree, deepestPath);
    expect(deepNode).not.toBeNull();
    expect(deepNode!.name).toBe(`level-${MAX_DEPTH - 1}`);

    const deepFilePath: string = `${deepestPath}/file-${MAX_DEPTH}-0.dat`;
    const deepFile: RevfsNode | null = findNode(tree, deepFilePath);
    expect(deepFile).not.toBeNull();
    expect(deepFile!.type).toBe('file');
  });

  it('verifies tree depth calculation', () => {
    const { tree } = createDeepTree(MAX_DEPTH, FILES_PER_LEVEL);
    const maxDepth: number = calculateMaxDepth(tree);
    expect(maxDepth).toBe(MAX_DEPTH + 1);
  });

  it('counts all nodes correctly in deep tree', () => {
    const { tree, totalDirs, totalFiles } = createDeepTree(MAX_DEPTH, FILES_PER_LEVEL);
    const counts: { dirs: number; files: number; } = countNodes(tree);
    expect(counts.dirs).toBe(totalDirs + 3);
    expect(counts.files).toBe(totalFiles);
  });

  it('removes file from deepest level', () => {
    const { tree, allFilePaths } = createDeepTree(MAX_DEPTH, FILES_PER_LEVEL);
    const deepFilePath: string = allFilePaths[allFilePaths.length - 1];
    expect(findNode(tree, deepFilePath)).not.toBeNull();
    const [newTree] = removeFile(tree, deepFilePath);
    expect(findNode(newTree, deepFilePath)).toBeNull();
  });

  it('removes directory at mid-level (cascades children removal)', () => {
    const { tree } = createDeepTree(MAX_DEPTH, FILES_PER_LEVEL);
    const segments: unknown[] = [];
    for (let i: number = 0; i < Math.floor(MAX_DEPTH / 2); i++) {
      segments.push(`level-${i}`);
    }
    const actualMidPath: string = '/' + segments.join('/');
    expect(findNode(tree, actualMidPath)).not.toBeNull();
    const [newTree] = rmdir(tree, actualMidPath);
    expect(findNode(newTree, actualMidPath)).toBeNull();
  });

  it('adds new directory at deepest level', () => {
    const { tree, allDirPaths } = createDeepTree(MAX_DEPTH, FILES_PER_LEVEL);
    const deepestPath: string = allDirPaths[allDirPaths.length - 1];
    const newSubDir: string = `${deepestPath}/even-deeper`;
    const [newTree] = mkdir(tree, newSubDir);
    const node: RevfsNode | null = findNode(newTree, newSubDir);
    expect(node).not.toBeNull();
    expect(node!.type).toBe('directory');
  });

  it('adds file to deepest level', () => {
    const { tree, allDirPaths } = createDeepTree(MAX_DEPTH, FILES_PER_LEVEL);
    const deepestPath: string = allDirPaths[allDirPaths.length - 1];
    const newFilePath: string = `${deepestPath}/extra-file.txt`;
    const meta: RevfsFileMetadata = makeMeta({ fileId: 'extra', fileName: 'extra-file.txt' });
    const [newTree] = placeFile(tree, newFilePath, meta, CID_A);
    const node: RevfsNode | null = findNode(newTree, newFilePath);
    expect(node).not.toBeNull();
    expect(node!.type).toBe('file');
  });

  it('merges two deep trees with different structures', () => {
    let localTree: RevfsNode = createDefaultTree();
    let remoteTree: RevfsNode = createDefaultTree();

    for (let d: number = 0; d < 10; d++) {
      const segs: string[] = Array.from({ length: d + 1 }, (_, i) => `level-${i}`);
      const path: string = '/' + segs.join('/');
      [localTree] = mkdir(localTree, path);
      [remoteTree] = mkdir(remoteTree, path);
    }

    [localTree] = mkdir(localTree, '/level-0/level-1/level-2/level-3/level-4/level-5/level-6/level-7/level-8/level-9/branch-a');
    [remoteTree] = mkdir(remoteTree, '/level-0/level-1/level-2/level-3/level-4/level-5/level-6/level-7/level-8/level-9/branch-b');

    const metaA: RevfsFileMetadata = makeMeta({ fileId: 'local-file', fileName: 'local.txt' });
    const metaB: RevfsFileMetadata = makeMeta({ fileId: 'remote-file', fileName: 'remote.txt' });
    [localTree] = placeFile(localTree, '/level-0/level-1/level-2/level-3/level-4/level-5/level-6/level-7/level-8/level-9/branch-a/local.txt', metaA, CID_A);
    [remoteTree] = placeFile(remoteTree, '/level-0/level-1/level-2/level-3/level-4/level-5/level-6/level-7/level-8/level-9/branch-b/remote.txt', metaB, CID_A);

    const merged: RevfsNode = mergeTrees(localTree, remoteTree);
    expect(findNode(merged, '/level-0/level-1/level-2/level-3/level-4/level-5/level-6/level-7/level-8/level-9/branch-a')).not.toBeNull();
    expect(findNode(merged, '/level-0/level-1/level-2/level-3/level-4/level-5/level-6/level-7/level-8/level-9/branch-b')).not.toBeNull();
    expect(findNode(merged, '/level-0/level-1/level-2/level-3/level-4/level-5/level-6/level-7/level-8/level-9/branch-a/local.txt')).not.toBeNull();
    expect(findNode(merged, '/level-0/level-1/level-2/level-3/level-4/level-5/level-6/level-7/level-8/level-9/branch-b/remote.txt')).not.toBeNull();
  });

  it('applies remote operations to deep tree', () => {
    const { tree } = createDeepTree(20, 2);
    const deepPath: string = '/level-0/level-1/level-2/level-3/level-4/level-5/level-6/level-7/level-8/level-9';

    const mkdirOp: { op_id: string; op_type: RevfsOpType; path: string; timestamp: number; } = { op_id: '1', op_type: RevfsOpType.Mkdir, path: `${deepPath}/remote-dir`, timestamp: Date.now() };
    let result: RevfsNode = applyRemoteOp(tree, mkdirOp, CID_B);
    expect(findNode(result, `${deepPath}/remote-dir`)).not.toBeNull();

    const meta: RevfsFileMetadata = makeMeta({ fileId: 'remote-deep', fileName: 'remote.dat', uploadedByCid: CID_A });
    const placeOp: { op_id: string; op_type: RevfsOpType; path: string; metadata: RevfsFileMetadata; timestamp: number; } = { op_id: '2', op_type: RevfsOpType.PlaceFile, path: `${deepPath}/remote-dir/remote.dat`, metadata: meta, timestamp: Date.now() };
    result = applyRemoteOp(result, placeOp, CID_B);
    const file: RevfsNode | null = findNode(result, `${deepPath}/remote-dir/remote.dat`);
    expect(file).not.toBeNull();
    // CID_A uploaded; the viewer (CID_B) received the bytes, so hosts them.
    expect(file!.fileState).toBe(RevfsFileState.Hosted);

    const removeOp: { op_id: string; op_type: RevfsOpType; path: string; timestamp: number; } = { op_id: '3', op_type: RevfsOpType.RemoveFile, path: `${deepPath}/remote-dir/remote.dat`, timestamp: Date.now() };
    result = applyRemoteOp(result, removeOp, CID_B);
    expect(findNode(result, `${deepPath}/remote-dir/remote.dat`)).toBeNull();
  });
});
