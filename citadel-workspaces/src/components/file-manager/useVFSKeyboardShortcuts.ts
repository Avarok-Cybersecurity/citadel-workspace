import { useEffect, useCallback } from "react";
import type { RevfsNode } from "@/types/revfs-types";
import { findNodeByPath } from "@/lib/revfs/tree-operations";
import { VFS_SHORTCUTS, matchesShortcut, isForeignKeyTarget, type VfsShortcut } from "./vfs-shortcuts";
import { canDelete, canDownload, canModify } from './item-permissions';
import type { VFSItemActions } from './vfs-item-actions';

interface KeyboardShortcutsDeps {
  tree: RevfsNode;
  selectedPaths: ReadonlySet<string>;
  renamingPath: string | null;
  currentPath: string;
  hasPasteItems: boolean;
  actions: VFSItemActions;
  setRenamingPath: (path: string | null) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
}

/**
 * The file manager's keys, answering exactly what vfs-shortcuts.ts lists and the
 * menus advertise. Space is not here: the focused item answers it (it selects,
 * and the selection is what the inspector shows).
 */
export function useVFSKeyboardShortcuts({
  tree, selectedPaths, renamingPath, currentPath, hasPasteItems,
  actions, setRenamingPath, onSelectAll, onClearSelection,
}: KeyboardShortcutsDeps): void {
  const getSelectedNodes: () => RevfsNode[] = useCallback((): RevfsNode[] => {
    return Array.from(selectedPaths)
      .map(path => findNodeByPath(tree, path))
      .filter((n): n is RevfsNode => n !== null);
  }, [selectedPaths, tree]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (renamingPath || isForeignKeyTarget(e.target)) return;

      const selected: RevfsNode[] = getSelectedNodes();
      const modifiable: RevfsNode[] = selected.filter(canModify);
      const on = (s: VfsShortcut): boolean => matchesShortcut(e, s);

      if (on(VFS_SHORTCUTS.rename)) {
        if (selected.length === 1 && modifiable.length === 1) {
          e.preventDefault();
          setRenamingPath(modifiable[0].path);
        }
      } else if (on(VFS_SHORTCUTS.download)) {
        if (selected.length === 1 && canDownload(selected[0])) {
          e.preventDefault();
          actions.download(selected[0]);
        }
      } else if (on(VFS_SHORTCUTS.remove)) {
        const deletable: RevfsNode[] = selected.filter(canDelete);
        if (deletable.length > 0) { e.preventDefault(); actions.remove(deletable); }
      } else if (on(VFS_SHORTCUTS.copy)) {
        if (modifiable.length > 0) { e.preventDefault(); actions.copy(modifiable); }
      } else if (on(VFS_SHORTCUTS.cut)) {
        if (modifiable.length > 0) { e.preventDefault(); actions.cut(modifiable); }
      } else if (on(VFS_SHORTCUTS.paste)) {
        if (hasPasteItems) { e.preventDefault(); void actions.paste(currentPath); }
      } else if (on(VFS_SHORTCUTS.selectAll)) {
        e.preventDefault(); onSelectAll();
      } else if (on(VFS_SHORTCUTS.clear)) {
        if (selected.length > 0) { e.preventDefault(); onClearSelection(); }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return (): void => document.removeEventListener('keydown', handleKeyDown);
  }, [renamingPath, getSelectedNodes, currentPath, hasPasteItems, actions, onSelectAll, onClearSelection, setRenamingPath]);
}
