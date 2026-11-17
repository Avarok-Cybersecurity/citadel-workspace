/**
 * One item as a tile: icon, name, size and date, and the E2E lock in peer storage.
 * Behaviour is useItemActivation's, shared with the list row.
 */
import { isDownloadableState } from '@/lib/revfs/file-states';
import { cn } from '@/lib/utils';
import { VFSContextMenu } from './VFSContextMenu';
import { VFSRenameInput } from './VFSRenameInput';
import { E2ELock, ItemIcon, PendingMark } from './ItemGlyphs';
import { formatSize } from './item-format';
import { useItemActivation, type ItemActivation } from './useItemActivation';
import { folderSummary, openTitle, type VFSItemViewProps } from './vfs-item-view';

export function GridItem(props: VFSItemViewProps): JSX.Element {
  const { node, actions, folder, isRenaming, isCut, pendingPeer, isSelected, isP2P, modified, hasPasteItems, onSelect, onStartRename, onRenameCancel } = props;
  const act: ItemActivation = useItemActivation(node, actions, onSelect);
  const isDir: boolean = node.type === 'directory';
  const meta: string = isDir ? folderSummary(node) : `${formatSize(node.fileMetadata?.fileSize ?? 0)} · ${modified}`;

  return (
    <VFSContextMenu node={node} folder={folder} actions={actions} hasPasteItems={hasPasteItems} onStartRename={onStartRename}>
      <div
        className={cn(
          'relative flex min-w-0 cursor-pointer select-none flex-col gap-[10px] rounded-[6px] border border-border bg-card p-[14px] transition-colors hover:bg-surface',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          act.dragOver && 'bg-success/15 ring-1 ring-success',
          isCut && 'opacity-50',
          isSelected && 'bg-primary/15 text-foreground border-primary-accent hover:bg-primary/20',
        )}
        role="button"
        tabIndex={0}
        aria-pressed={isSelected}
        data-testid={`vfs-item-${node.name}`}
        data-vfs-item=""
        title={openTitle(node, !isDir && isDownloadableState(node.fileState))}
        onClick={act.onClick}
        onDoubleClick={act.onDoubleClick}
        onKeyDown={act.onKeyDown}
        onDragOver={act.onDragOver}
        onDragLeave={act.onDragLeave}
        onDrop={act.onDrop}
      >
        {isP2P && <E2ELock className="absolute right-[10px] top-[10px]" />}
        <div className="flex h-[56px] items-center justify-center"><ItemIcon node={node} size="tile" /></div>
        <div className="min-w-0">
          {isRenaming ? (
            <VFSRenameInput
              currentName={node.name}
              onConfirm={(name: string) => { onRenameCancel(); void actions.rename(node.path, name); }}
              onCancel={onRenameCancel}
              isDirectory={isDir}
            />
          ) : (
            <span className="block truncate text-sm font-medium text-foreground">{node.name}</span>
          )}
          <span className="block truncate text-xs text-muted-foreground">{meta}</span>
          {pendingPeer !== null && <PendingMark peer={pendingPeer} />}
        </div>
      </div>
    </VFSContextMenu>
  );
}
