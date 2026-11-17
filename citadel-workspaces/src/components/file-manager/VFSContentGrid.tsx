/**
 * The open folder's contents, as a list (the default) or a grid of tiles.
 *
 * The canvas around the items is a drop target and carries the canvas menu (New
 * folder, Upload, Paste, Refresh). It does not clear the selection on a click:
 * a clickable div is out of keyboard reach, and every way to make it reachable
 * nests controls inside a control. Escape, the inspector's close and the bulk
 * bar's Clear do it. Filter and sort are the view's own, not the address's.
 */
import { useCallback, useState, type DragEvent } from 'react';
import { searchMatcher as searchMatcherFor } from '@/lib/fold-for-search';
import type { RevfsNode } from '@/types/revfs-types';
import type { SelectMode } from '@/hooks/useVFSSelection';
import { cn } from '@/lib/utils';
import { findNodeByPath } from '@/lib/revfs/tree-operations';
import { VFSContextMenu } from './VFSContextMenu';
import { GridItem } from './VFSGridItem';
import { VFSListRow } from './VFSListRow';
import { VFSEmptyFolder, VFSFolderNotFound, VFSNoMatches } from './VFSEmptyState';
import { sortItems, type SortField, type SortDirection } from './vfs-content-helpers';
import { formatModified } from './item-format';
import { useVFSKeyboardShortcuts } from './useVFSKeyboardShortcuts';
import { LIST_COLUMNS, type VFSItemViewProps } from './vfs-item-view';
import type { VFSItemActions } from './vfs-item-actions';
import type { UploadAvailability } from './upload-refusal';

export type { SortField, SortDirection };
export type ContentView = 'list' | 'grid';

export interface VFSContentGridProps {
  tree: RevfsNode;
  currentPath: string;
  view: ContentView;
  actions: VFSItemActions;
  isP2P: boolean;
  /** Named in the not-found state: whose storage has no such folder. */
  storageName: string;
  /** Changes the peer has not confirmed yet; see useRevfsTree. */
  pendingPaths: ReadonlySet<string>;
  /** Who is being waited on, for the pending mark. */
  peerLabel: string;
  cutItemPaths: ReadonlySet<string>;
  hasPasteItems: boolean;
  selectedPaths: ReadonlySet<string>;
  onSelect: (path: string, mode: SelectMode, allPaths: string[]) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  sortField: SortField;
  sortDirection: SortDirection;
  filterText: string;
  onClearFilter: () => void;
  /** Whether the open folder takes an upload, and why not. */
  upload: UploadAvailability;
  /** Who uploaded a file, by name. */
  nameOf: (cid: bigint) => string;
  now: number;
}

function ListHeader(): JSX.Element {
  return (
    <div className={cn(LIST_COLUMNS, 'border-b border-border px-[14px] py-[8px] text-xs font-semibold uppercase tracking-wide text-muted-foreground')} aria-hidden="true">
      <span>Name</span><span className="hidden md:block">From</span><span className="text-right">Size</span><span className="hidden md:block">Modified</span><span />
    </div>
  );
}

export function VFSContentGrid(props: VFSContentGridProps): JSX.Element {
  const {
    tree, currentPath, view, actions, isP2P, storageName, pendingPaths, peerLabel, cutItemPaths, hasPasteItems,
    selectedPaths, onSelect, onSelectAll, onClearSelection, sortField, sortDirection, filterText, onClearFilter,
    upload, nameOf, now,
  } = props;
  const [dragOver, setDragOver] = useState(false);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);

  useVFSKeyboardShortcuts({
    tree, selectedPaths, renamingPath, currentPath, hasPasteItems, actions, setRenamingPath, onSelectAll, onClearSelection,
  });

  const startRename: (node: RevfsNode) => void = useCallback((node: RevfsNode): void => setRenamingPath(node.path), []);
  const stopRename: () => void = useCallback((): void => setRenamingPath(null), []);

  const folder: RevfsNode | null = findNodeByPath(tree, currentPath);
  if (folder === null) {
    return <div className="flex flex-1 p-[16px]"><VFSFolderNotFound path={currentPath} storageName={storageName} onTop={() => actions.openFolder('/')} /></div>;
  }

  // Folded ONCE, not per child: `matchesSearch` folds both arguments per call.
  const matches: (haystack: string) => boolean = searchMatcherFor(filterText);
  const all: RevfsNode[] = folder.children ?? [];
  const items: RevfsNode[] = sortItems(filterText ? all.filter((n: RevfsNode): boolean => matches(n.name)) : all, sortField, sortDirection);
  const paths: string[] = items.map((n: RevfsNode): string => n.path);

  const onDragOver = (e: DragEvent): void => { e.preventDefault(); setDragOver(true); };
  const onDrop = (e: DragEvent): void => {
    e.preventDefault(); setDragOver(false);
    if (e.dataTransfer.files.length > 0) actions.drop(currentPath, e.dataTransfer.files);
  };

  const itemProps = (node: RevfsNode): VFSItemViewProps => ({
    node, actions, folder: currentPath, isRenaming: renamingPath === node.path, isCut: cutItemPaths.has(node.path),
    pendingPeer: pendingPaths.has(node.path) ? peerLabel : null, isSelected: selectedPaths.has(node.path), isP2P,
    from: node.fileMetadata ? nameOf(node.fileMetadata.uploadedByCid) : null,
    modified: formatModified(node.updatedAt, now, undefined), hasPasteItems,
    onSelect: (path: string, mode: SelectMode): void => onSelect(path, mode, paths),
    onStartRename: startRename, onRenameCancel: stopRename,
  });

  return (
    <VFSContextMenu node={null} folder={currentPath} actions={actions} hasPasteItems={hasPasteItems} onStartRename={startRename}>
      <div
        className={cn('flex min-h-0 flex-1 flex-col overflow-y-auto p-[16px]', dragOver && 'bg-success/10')}
        data-testid="vfs-canvas"
        onDragOver={onDragOver} onDragLeave={() => setDragOver(false)} onDrop={onDrop}
      >
        {items.length === 0 && (filterText
          ? <VFSNoMatches filterText={filterText} onClearFilter={onClearFilter} />
          : <VFSEmptyFolder folder={currentPath} upload={upload} onUpload={() => actions.upload(currentPath)} />)}
        {items.length > 0 && view === 'list' && (
          <div className="overflow-hidden rounded-[6px] border border-border bg-card" aria-label="Items in this folder" role="group">
            <ListHeader />
            {items.map((node: RevfsNode) => <VFSListRow key={node.path} {...itemProps(node)} />)}
          </div>
        )}
        {items.length > 0 && view === 'grid' && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-[12px]" aria-label="Items in this folder" role="group">
            {items.map((node: RevfsNode) => <GridItem key={node.path} {...itemProps(node)} />)}
          </div>
        )}
      </div>
    </VFSContextMenu>
  );
}
