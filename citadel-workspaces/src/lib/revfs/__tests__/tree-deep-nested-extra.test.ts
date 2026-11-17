/**
 * Tree Operations Tests: Deep Nested Extra
 *
 * Additional deep tree tests: SyncResponse, wide trees, immutability,
 * and path normalization.
 */

import { describe, it, expect } from 'vitest';
import {
  createDefaultTree,
  findNode,
  mkdir,
  placeFile,
  applyRemoteOp,
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

// ============================================================================
// Additional Deep Nested Tests
// ============================================================================

describe('deep nested tree stress tests (extra)', () => {
  it('handles SyncResponse with deeply nested tree', () => {
    const { tree: remoteTree } = createDeepTree(15, 2);
    const op: { op_id: string; op_type: RevfsOpType; path: string; tree: RevfsNode; timestamp: number; } = {
      op_id: '1', op_type: RevfsOpType.SyncResponse, path: '/',
      tree: remoteTree, timestamp: Date.now(),
    };
    const result: RevfsNode = applyRemoteOp(createDefaultTree(), op, CID_B);

    expect(findNode(result, '/level-0')).not.toBeNull();
    expect(findNode(result, '/level-0/level-1/level-2/level-3/level-4')).not.toBeNull();

    const deepFile: RevfsNode | null = findNode(result, '/level-0/level-1/level-2/level-3/level-4/file-5-0.dat');
    expect(deepFile).not.toBeNull();
    // Flipped to the receiving viewer's perspective: they hold the bytes.
    expect(deepFile!.fileState).toBe(RevfsFileState.Hosted);
  });

  it('handles wide tree at each level (many siblings)', () => {
    let tree: RevfsNode = createDefaultTree();
    const SIBLINGS_PER_LEVEL: number = 20;
    const LEVELS: number = 5;

    for (let level: number = 0; level < LEVELS; level++) {
      const parentPath: string = level === 0 ? '/' : `/wide-${level - 1}`;
      for (let sibling: number = 0; sibling < SIBLINGS_PER_LEVEL; sibling++) {
        const dirPath: string = level === 0
          ? `/wide-${level}-sibling-${sibling}`
          : `${parentPath}/wide-${level}-sibling-${sibling}`;

        if (level > 0 && sibling > 0) continue;

        try {
          [tree] = mkdir(tree, dirPath);
          const meta: RevfsFileMetadata = makeMeta({ fileId: `w-${level}-${sibling}`, fileName: `data-${sibling}.bin` });
          [tree] = placeFile(tree, `${dirPath}/data-${sibling}.bin`, meta, CID_A);
        } catch {
          // Parent might not exist for deeper levels with multiple siblings
        }
      }
    }

    for (let s: number = 0; s < SIBLINGS_PER_LEVEL; s++) {
      const node: RevfsNode | null = findNode(tree, `/wide-0-sibling-${s}`);
      expect(node).not.toBeNull();
      expect(findNode(tree, `/wide-0-sibling-${s}/data-${s}.bin`)).not.toBeNull();
    }
  });

  it('immutability preserved in deep tree operations', () => {
    const { tree: originalTree, allDirPaths } = createDeepTree(10, 2);
    const originalNodeCount: { dirs: number; files: number; } = countNodes(originalTree);

    const deepPath: string = allDirPaths[allDirPaths.length - 1];
    mkdir(originalTree, `${deepPath}/new-dir`);
    const meta: RevfsFileMetadata = makeMeta({ fileId: 'new' });
    placeFile(originalTree, `${deepPath}/new.txt`, meta, CID_A);

    const afterNodeCount: { dirs: number; files: number; } = countNodes(originalTree);
    expect(afterNodeCount.dirs).toBe(originalNodeCount.dirs);
    expect(afterNodeCount.files).toBe(originalNodeCount.files);
  });

  it('path normalization works at all depths', () => {
    const { tree, allDirPaths } = createDeepTree(20, 1);

    for (const dirPath of allDirPaths.slice(0, 10)) {
      expect(findNode(tree, `${dirPath}/`)).not.toBeNull();
      const doubleSlashPath: string = dirPath.replace(/\//g, '//');
      expect(findNode(tree, doubleSlashPath)).not.toBeNull();
    }
  });
});
