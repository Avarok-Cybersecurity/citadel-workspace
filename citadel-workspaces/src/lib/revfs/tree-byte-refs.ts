/**
 * RE-VFS byte-key reference counting (pure).
 *
 * A copy made with `copyNode` gets a fresh `fileId` but SHARES the original's
 * `fileMetadata.virtualDirectory` — the immutable upload-time key the backend
 * stores the bytes under. The backend has send / download / delete and no way
 * to duplicate or re-path an object, and the browser does not hold the bytes
 * (peer- and server-scoped files live on the remote node), so a copy cannot
 * re-upload under its own key: sharing is the only representable relationship.
 *
 * That sharing made deletion destructive: removing EITHER copy issued a
 * backend delete for the shared key, destroying the bytes the surviving node
 * still pointed at — and an rmdir sweeping a folder that contained only a
 * copy destroyed bytes referenced from outside the folder entirely.
 *
 * Delete sites therefore consult this count and only issue the backend delete
 * when the node being removed is the LAST reference to its byte key.
 */

import type { RevfsNode } from '@/types/revfs-types';
import { findNode } from './tree-queries';

/**
 * Counts the file nodes in `tree` whose bytes live under `virtualDirectory`.
 *
 * An empty key identifies nothing on the backend (standard-transfer entries
 * from addSentFile carry ''), so it is never treated as shared: the count is
 * 0 and callers fall back to their per-node behaviour.
 */
export function countByteKeyRefs(tree: RevfsNode, virtualDirectory: string): number {
  if (virtualDirectory === '') return 0;

  let count: number = 0;
  const walk = (node: RevfsNode): void => {
    if (node.type === 'file' && node.fileMetadata?.virtualDirectory === virtualDirectory) {
      count++;
    }
    if (node.children) {
      for (const child of node.children) walk(child);
    }
  };
  walk(tree);
  return count;
}

/**
 * The key a new upload to `filePath` may store its bytes under.
 *
 * The path itself, unless some OTHER node already keeps its bytes there — a
 * file renamed or moved away from `filePath` keeps its upload-time key, and an
 * upload reusing it sent the new bytes over the old file's. A node being
 * replaced at `filePath` does not count: overwriting its bytes is the upload.
 */
export function byteKeyFor(tree: RevfsNode, filePath: string, fileId: string): string {
  const replaced: RevfsNode | null = findNode(tree, filePath);
  const replacedHoldsIt: number =
    replaced?.type === 'file' && replaced.fileMetadata?.virtualDirectory === filePath ? 1 : 0;
  return countByteKeyRefs(tree, filePath) - replacedHoldsIt > 0 ? `${filePath}.${fileId}` : filePath;
}
