/**
 * Tree Operations Tests: Basics
 *
 * Tests for peerTreeKey, normalizePath, createDefaultTree, findNode.
 */

import { describe, it, expect } from 'vitest';
import {
  peerTreeKey,
  createDefaultTree,
  findNode,
  normalizePath,
} from '../tree-operations';
import {
  SENT_FILES_DIR,
  RECEIVED_FILES_DIR,
} from '@/types/revfs-types';
import { CID_A, CID_B } from './tree-test-helpers';
import type { RevfsNode } from '@/types/revfs-types';

// ============================================================================
// peerTreeKey
// ============================================================================

describe('peerTreeKey', () => {
  // Directional: two accounts in one browser share OPFS, and a shared key made
  // their two views one file. See the-tree-survives-a-reload.test.ts.
  it('gives each side of a pair its own key', () => {
    expect(peerTreeKey(CID_A, CID_B)).not.toBe(peerTreeKey(CID_B, CID_A));
  });

  it('puts the viewing account first', () => {
    expect(peerTreeKey(CID_B, CID_A)).toBe('200_100');
  });
});

// ============================================================================
// normalizePath
// ============================================================================

describe('normalizePath', () => {
  it('adds leading slash', () => {
    expect(normalizePath('foo')).toBe('/foo');
  });
  it('removes trailing slash', () => {
    expect(normalizePath('/foo/')).toBe('/foo');
  });
  it('collapses double slashes', () => {
    expect(normalizePath('//foo//bar//')).toBe('/foo/bar');
  });
  it('root stays as /', () => {
    expect(normalizePath('/')).toBe('/');
  });
});

// ============================================================================
// createDefaultTree
// ============================================================================

describe('createDefaultTree', () => {
  it('has root with two protected folders', () => {
    const tree: RevfsNode = createDefaultTree();
    expect(tree.path).toBe('/');
    expect(tree.children).toHaveLength(2);
    const paths: string[] = tree.children!.map(c => c.path);
    expect(paths).toContain(RECEIVED_FILES_DIR);
    expect(paths).toContain(SENT_FILES_DIR);
  });
});

// ============================================================================
// findNode
// ============================================================================

describe('findNode', () => {
  it('finds root', () => {
    const tree: RevfsNode = createDefaultTree();
    expect(findNode(tree, '/')).toBe(tree);
  });

  it('finds child by path', () => {
    const tree: RevfsNode = createDefaultTree();
    const node: RevfsNode | null = findNode(tree, SENT_FILES_DIR);
    expect(node).not.toBeNull();
    expect(node!.name).toBe('Sent Files');
  });

  it('returns null for missing path', () => {
    const tree: RevfsNode = createDefaultTree();
    expect(findNode(tree, '/nonexistent')).toBeNull();
  });
});
