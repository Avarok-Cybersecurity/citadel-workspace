/**
 * What a list row and a grid tile are both given: the item, how it stands, and
 * what can be done to it.
 */
import type { RevfsNode } from '@/types/revfs-types';
import type { SelectMode } from '@/hooks/useVFSSelection';
import type { VFSItemActions } from './vfs-item-actions';

export interface VFSItemViewProps {
  node: RevfsNode;
  actions: VFSItemActions;
  /** The open folder, for the menus. */
  folder: string;
  isRenaming: boolean;
  isCut: boolean;
  /** The peer whose confirmation this item awaits, or null. */
  pendingPeer: string | null;
  isSelected: boolean;
  /** Peer storage: every item is end-to-end encrypted and says so. */
  isP2P: boolean;
  /** Who put it there, by name; null where nobody is recorded (folders). */
  from: string | null;
  modified: string;
  hasPasteItems: boolean;
  onSelect: (path: string, mode: SelectMode) => void;
  onStartRename: (node: RevfsNode) => void;
  onRenameCancel: () => void;
}

/** "3 items", "Empty": a folder's size, as the tiles and inspector show it. */
export function folderSummary(node: RevfsNode): string {
  const n: number = node.children?.length ?? 0;
  if (n === 0) return 'Empty';
  return `${n} item${n === 1 ? '' : 's'}`;
}

export function openTitle(node: RevfsNode, opens: boolean): string | undefined {
  return opens ? `${node.name} (double-click or Enter to open)` : undefined;
}

/** Name takes the room; From and Modified hide on a phone; Size keeps its width. */
export const LIST_COLUMNS: string = 'grid grid-cols-[minmax(0,1fr)_72px_16px] md:grid-cols-[minmax(0,1fr)_minmax(0,160px)_80px_120px_16px] items-center gap-x-[12px]';
