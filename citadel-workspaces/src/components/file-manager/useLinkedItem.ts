/**
 * A link's `item=`: select it once the tree has it, which opens the inspector.
 *
 * Once per link: the tree updates on every peer acknowledgement, and an effect
 * that reselected on each would undo the reader clearing the selection. An item
 * the folder does not hold is returned, so the screen can say so rather than
 * open the folder as though the link had pointed at nothing in particular.
 */
import { useEffect, useRef, type MutableRefObject } from 'react';
import type { RevfsNode, TreeKey } from '@/types/revfs-types';
import { findNodeByPath } from '@/lib/revfs/tree-operations';

export function useLinkedItem(
  tree: RevfsNode | null,
  folder: string,
  item: string | null,
  treeKey: TreeKey | null,
  select: (paths: string[]) => void,
): string | null {
  const applied: MutableRefObject<string | null> = useRef<string | null>(null);
  const key: string | null = item === null || treeKey === null ? null : `${treeKey}|${folder}|${item}`;
  const itemPath: string = folder === '/' ? `/${item ?? ''}` : `${folder}/${item ?? ''}`;
  const node: RevfsNode | null = tree !== null && item !== null ? findNodeByPath(tree, itemPath) : null;

  useEffect((): void => {
    if (key === null || tree === null || applied.current === key) return;
    applied.current = key;
    if (node) select([node.path]);
  }, [key, tree, node, select]);

  return key !== null && tree !== null && node === null ? item : null;
}
