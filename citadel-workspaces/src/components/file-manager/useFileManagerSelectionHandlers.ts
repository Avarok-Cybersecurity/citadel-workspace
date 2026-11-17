import { useCallback } from 'react';
import { toast } from 'sonner';
import type { RevfsNode, TreeKey } from '@/types/revfs-types';
import { findNodeByPath } from './useFileManagerContent';

interface SelectionDeps {
  tree: RevfsNode | null;
  currentPath: string;
  /** The grid's filter, so Select All cannot reach what is hidden. */
  filterText: string;
  currentTreeKey: TreeKey | null;
  cut: (items: RevfsNode[], treeKey: TreeKey) => void;
  copyToClipboard: (items: RevfsNode[], treeKey: TreeKey) => void;
  selectAll: (paths: string[]) => void;
}

/**
 * Clipboard and select-all over the current selection.
 *
 * Split out of useFileManagerHandlers to keep that file under the 250-line cap
 * once Select All learned to honour the grid's filter.
 */
export function useFileManagerSelectionHandlers({
  tree, currentPath, filterText, currentTreeKey, cut, copyToClipboard, selectAll,
}: SelectionDeps): { handleCutMultiple: (nodes: RevfsNode[]) => void; handleCopyMultiple: (nodes: RevfsNode[]) => void; handleSelectAll: () => void; } {
  const handleCutMultiple: (nodes: RevfsNode[]) => void = useCallback((nodes: RevfsNode[]): void => {
    if (!currentTreeKey) return;
    cut(nodes, currentTreeKey);
    toast.info(`Cut ${nodes.length} item${nodes.length !== 1 ? 's' : ''}`);
  }, [cut, currentTreeKey]);

  const handleCopyMultiple: (nodes: RevfsNode[]) => void = useCallback((nodes: RevfsNode[]): void => {
    if (!currentTreeKey) return;
    copyToClipboard(nodes, currentTreeKey);
    toast.info(`Copied ${nodes.length} item${nodes.length !== 1 ? 's' : ''}`);
  }, [copyToClipboard, currentTreeKey]);

  const handleSelectAll: () => void = useCallback((): void => {
    if (!tree) return;
    const currentNode: RevfsNode | null = tree.path === currentPath ? tree : findNodeByPath(tree, currentPath);
    if (!currentNode?.children) return;
    // Filtered, matching the grid: reading children directly let Ctrl+A under
    // a filter select hidden files, which Delete then removed.
    const needle: string = filterText.toLowerCase();
    const visible: RevfsNode[] = needle ? currentNode.children.filter((n) => n.name.toLowerCase().includes(needle)) : currentNode.children;
    // One update, and it says what it means.
    //
    // This looped `selectItem(path, i === 0 ? 'replace' : 'toggle')`, which
    // works only because `replace` clears the set before the toggles run: read
    // in isolation, "toggle every item" is the opposite of "select all", and it
    // would become so the moment the first item stopped being `replace`.
    // `selectAll` is on the selection hook and had no caller.
    selectAll(visible.map((n) => n.path));
  }, [tree, currentPath, filterText, selectAll]);

  return { handleCutMultiple, handleCopyMultiple, handleSelectAll };
}
