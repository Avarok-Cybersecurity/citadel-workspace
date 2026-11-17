/**
 * How an item answers the pointer and the keyboard, for list rows and grid tiles alike.
 *
 * - A click selects (⌘/Ctrl toggles, Shift extends), and the selection opens the
 *   inspector. A click used to start a download as well, so selecting a file to
 *   inspect it pulled it from the peer.
 * - Double-click or Enter opens: a folder is entered, a file fetched.
 * - Space selects, which is Preview: the inspector shows what is selected.
 * - Where there is no hover (touch), a tap on a folder opens it; a tap on a file
 *   selects it, which on a phone raises the inspector sheet with its actions.
 * - A folder accepts dropped files.
 */
import { useState, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react';
import type { RevfsNode } from '@/types/revfs-types';
import type { SelectMode } from '@/hooks/useVFSSelection';
import { activateOnKey } from '@/lib/a11y';
import { isDownloadableState } from '@/lib/revfs/file-states';
import type { VFSItemActions } from './vfs-item-actions';

export interface ItemActivation {
  dragOver: boolean;
  onClick: (e: MouseEvent) => void;
  onDoubleClick: () => void;
  onKeyDown: (e: KeyboardEvent) => void;
  onDragOver: (e: DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: DragEvent) => void;
}

function selectMode(e: MouseEvent | KeyboardEvent): SelectMode {
  if (e.ctrlKey || e.metaKey) return 'toggle';
  return e.shiftKey ? 'range' : 'replace';
}

function hasNoHover(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(hover: none)').matches;
}

export function useItemActivation(
  node: RevfsNode,
  actions: VFSItemActions,
  onSelect: (path: string, mode: SelectMode) => void,
): ItemActivation {
  const [dragOver, setDragOver] = useState(false);
  const isDir: boolean = node.type === 'directory';
  const opens: boolean = isDir || isDownloadableState(node.fileState);

  const open = (): void => {
    if (isDir) actions.openFolder(node.path);
    else if (opens) actions.openFile(node);
  };
  const select = (e: MouseEvent | KeyboardEvent): void => onSelect(node.path, selectMode(e));

  return {
    dragOver,
    onClick: (e: MouseEvent): void => {
      if (isDir && hasNoHover()) { open(); return; }
      select(e);
    },
    onDoubleClick: open,
    onKeyDown: (e: KeyboardEvent): void => {
      // A key typed into the rename field inside the item is the field's.
      if (e.target !== e.currentTarget) return;
      if (opens && e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); open(); return; }
      activateOnKey(select)(e);
    },
    onDragOver: (e: DragEvent): void => {
      if (!isDir) return;
      e.preventDefault(); e.stopPropagation(); setDragOver(true);
    },
    onDragLeave: (): void => setDragOver(false),
    onDrop: (e: DragEvent): void => {
      e.preventDefault(); e.stopPropagation(); setDragOver(false);
      if (isDir && e.dataTransfer.files.length > 0) actions.drop(node.path, e.dataTransfer.files);
    },
  };
}
