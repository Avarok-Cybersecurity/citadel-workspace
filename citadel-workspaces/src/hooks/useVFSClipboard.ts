/**
 * useVFSClipboard Hook
 *
 * Manages clipboard state for copy/cut operations in the file manager.
 * Tracks which items are in the clipboard and the operation type.
 */

import { useState, useCallback } from 'react';
import type { RevfsNode, TreeKey } from '@/types/revfs-types';

export type ClipboardOperation = 'copy' | 'cut';

export interface ClipboardState {
  items: RevfsNode[];
  operation: ClipboardOperation | null;
  sourceTreeKey: TreeKey | null;
}

interface UseVFSClipboardResult {
  clipboard: ClipboardState;
  cut: (nodes: RevfsNode[], treeKey: TreeKey) => void;
  copy: (nodes: RevfsNode[], treeKey: TreeKey) => void;
  clear: () => void;
  hasItems: boolean;
  isCut: boolean;
  isCopy: boolean;
}

const EMPTY_CLIPBOARD: ClipboardState = {
  items: [],
  operation: null,
  sourceTreeKey: null,
};

export function useVFSClipboard(): UseVFSClipboardResult {
  const [clipboard, setClipboard] = useState<ClipboardState>(EMPTY_CLIPBOARD);

  const cut: (nodes: RevfsNode[], treeKey: TreeKey) => void = useCallback((nodes: RevfsNode[], treeKey: TreeKey): void => {
    setClipboard({
      items: nodes,
      operation: 'cut',
      sourceTreeKey: treeKey,
    });
  }, []);

  const copy: (nodes: RevfsNode[], treeKey: TreeKey) => void = useCallback((nodes: RevfsNode[], treeKey: TreeKey): void => {
    setClipboard({
      items: nodes,
      operation: 'copy',
      sourceTreeKey: treeKey,
    });
  }, []);

  const clear: () => void = useCallback((): void => {
    setClipboard(EMPTY_CLIPBOARD);
  }, []);

  return {
    clipboard,
    cut,
    copy,
    clear,
    hasItems: clipboard.items.length > 0,
    isCut: clipboard.operation === 'cut',
    isCopy: clipboard.operation === 'copy',
  };
}
