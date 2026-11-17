/**
 * RE-VFS Tree Queries (Pure Functions)
 *
 * Tree traversal, lookups, path resolution, and utility functions.
 * No mutations — all read-only operations.
 */

import {
  type RevfsNode,
  type PeerPairKey,
  type ServerTreeKey,
  TreeScope,
} from '@/types/revfs-types';

// ============================================================================
// Key Generators
// ============================================================================

/**
 * The key THIS account's tree of its shared storage with `peer` lives under:
 * `${mine}_${peer}`.
 *
 * It was the sorted pair, "so both peers generate the same key". Nothing
 * needs them to: the key never crosses the wire, and each side's tree is its
 * own view (the same file is Remote to its uploader and Hosted to the holder).
 * What the shared key did do was put both views in ONE file on disk whenever
 * both accounts use the same browser, since OPFS is per origin: whichever tab
 * wrote last replaced the other's tree, and a reload showed that one.
 */
export function peerTreeKey(mine: bigint, peer: bigint): PeerPairKey {
  return `${mine}_${peer}`;
}

/** Where both accounts' trees were stored before `peerTreeKey` was directional. */
export function legacyPairKey(cidA: bigint, cidB: bigint): PeerPairKey {
  const a: bigint = cidA < cidB ? cidA : cidB;
  const b: bigint = cidA < cidB ? cidB : cidA;
  return `${a}_${b}`;
}

/**
 * Generate a server-scoped tree key for a client's server storage.
 * Format: `server_${cid}`
 */
export function serverTreeKey(cid: bigint): ServerTreeKey {
  return `server_${cid}`;
}

// ============================================================================
// Internal Utilities (shared by other tree modules)
// ============================================================================

export function makeOpId(): string {
  return crypto.randomUUID();
}

export function now(): number {
  return Date.now();
}

/**
 * Deep-copy a tree, preserving types.
 *
 * This used to be `JSON.parse(JSON.stringify(node, bigintToString))`, which
 * silently turned every `uploadedByCid` into a string. The field is typed
 * `bigint`, so the value and its type disagreed from the first mutation onward —
 * and every mutation clones (mkdir, rmdir, placeFile, removeFile, rename, move,
 * copy, merge), so no stored tree escaped it. A `=== someBigintCid` check
 * against a cloned node can only ever be false, and the corruption persists into
 * IndexedDB.
 *
 * structuredClone handles BigInt natively, which is also what the storage layer
 * does — the JSON round trip was the only thing in the path that could not.
 */
export function cloneTree(node: RevfsNode): RevfsNode {
  return structuredClone(node);
}

/** Normalize path: ensure leading slash, no trailing slash, no double slashes */
export function normalizePath(path: string): string {
  let p: string = path.replace(/\/+/g, '/');
  if (!p.startsWith('/')) p = '/' + p;
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

export function parentPath(path: string): string {
  const idx: number = path.lastIndexOf('/');
  return idx <= 0 ? '/' : path.slice(0, idx);
}

export function baseName(path: string): string {
  const idx: number = path.lastIndexOf('/');
  return idx < 0 ? path : path.slice(idx + 1);
}

/** Get file extension (without dot) */
export function getExtension(filename: string): string {
  const idx: number = filename.lastIndexOf('.');
  return idx > 0 ? filename.slice(idx + 1) : '';
}

// ============================================================================
// Default Tree
// ============================================================================

import { RECEIVED_FILES_DIR, SENT_FILES_DIR } from '@/types/revfs-types';

/**
 * Re-root `path` from `oldBase` onto `newBase`. Replaces
 * `path.replace(oldBase, newBase)`, written out at six sites: `String.replace`
 * interprets `$$`, `$&`, `` $` `` and `$'` in the REPLACEMENT, and folder names
 * may contain `$`. Renaming a folder to `cost$$report` rewrote descendant paths
 * to `cost$report`, so `findNode` missed every child: those files became
 * impossible to open, move or delete.
 */
export function rebasePath(path: string, oldBase: string, newBase: string): string {
  if (!path.startsWith(oldBase)) return path;
  return newBase + path.slice(oldBase.length);
}
export function createDefaultTree(): RevfsNode {
  const t: number = now();
  return {
    name: '/',
    type: 'directory',
    path: '/',
    children: [
      { name: 'Received Files', type: 'directory', path: RECEIVED_FILES_DIR, children: [], createdAt: t, updatedAt: t },
      { name: 'Sent Files', type: 'directory', path: SENT_FILES_DIR, children: [], createdAt: t, updatedAt: t },
    ],
    createdAt: t,
    updatedAt: t,
  };
}

// ============================================================================
// Find
// ============================================================================

export function findNode(tree: RevfsNode, path: string): RevfsNode | null {
  const target: string = normalizePath(path);
  if (tree.path === target) return tree;
  if (tree.children) {
    for (const child of tree.children) {
      const found: RevfsNode | null = findNode(child, target);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Check if a path exists in the tree.
 * Useful for validating path bar input.
 */
export function pathExists(tree: RevfsNode, path: string): boolean {
  return findNode(tree, normalizePath(path)) !== null;
}

// ============================================================================
// Storage Usage Calculation
// ============================================================================

/**
 * Calculate total storage used by summing file sizes in tree.
 *
 * For P2P mode (TreeScope.Peer):
 *   - Counts files with state Hosted (files I'm storing for my peer)
 *
 * For Server mode (TreeScope.Server):
 *   - Counts files with state ServerStored (files on the server)
 *
 * @param tree - The RE-VFS tree to calculate storage for
 * @param scope - TreeScope.Peer or TreeScope.Server
 * @returns Total bytes used
 */
/**
 * Every file node at or beneath `node`, in depth-first order.
 *
 * Removing a directory from the tree drops its whole subtree in one step, which
 * loses the list of files that were inside it. Callers that have to tell the
 * backend what to delete need that list BEFORE the removal, so this is
 * deliberately a read-only query rather than something rmdir returns.
 */
export function collectFiles(node: RevfsNode): RevfsNode[] {
  const files: RevfsNode[] = [];

  const traverse = (current: RevfsNode): void => {
    if (current.type === 'file') {
      files.push(current);
    }
    if (current.children) {
      for (const child of current.children) {
        traverse(child);
      }
    }
  };

  traverse(node);
  return files;
}
