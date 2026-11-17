/**
 * The node at `path`, or null.
 *
 * There were three byte-identical copies of this: two exported from
 * neighbouring files in the same directory, both imported by their neighbours,
 * and one private in a hook. Any change — symlink nodes, case-insensitive
 * paths — would have landed in one of the three.
 *
 * Its own module rather than tree-queries, which is at the file-length cap.
 */

import type { RevfsNode } from '@/types/revfs-types';

export function findNodeByPath(tree: RevfsNode, path: string): RevfsNode | null {
  if (tree.path === path) return tree;
  for (const child of tree.children ?? []) {
    const found: RevfsNode | null = findNodeByPath(child, path);
    if (found) return found;
  }
  return null;
}
