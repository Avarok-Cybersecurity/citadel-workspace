/**
 * One item as a row of the list: badge or folder, name, from, size, modified,
 * and the E2E lock in peer storage. The columns are the same grid template as
 * the header in VFSListView, so they line up without a table.
 */
import { Folder } from 'lucide-react';
import { isDownloadableState } from '@/lib/revfs/file-states';
import { cn } from '@/lib/utils';
import { VFSContextMenu } from './VFSContextMenu';
import { VFSRenameInput } from './VFSRenameInput';
import { E2ELock, FileBadgeChip, PendingMark } from './ItemGlyphs';
import { formatSize } from './item-format';
import { useItemActivation, type ItemActivation } from './useItemActivation';
import { LIST_COLUMNS, folderSummary, openTitle, type VFSItemViewProps } from './vfs-item-view';

export function VFSListRow(props: VFSItemViewProps): JSX.Element {
  const { node, actions, folder, isRenaming, isCut, pendingPeer, isSelected, isP2P, from, modified, hasPasteItems, onSelect, onStartRename, onRenameCancel } = props;
  const act: ItemActivation = useItemActivation(node, actions, onSelect);
  const isDir: boolean = node.type === 'directory';

  return (
    <VFSContextMenu node={node} folder={folder} actions={actions} hasPasteItems={hasPasteItems} onStartRename={onStartRename}>
      <div
        className={cn(
          LIST_COLUMNS,
          'min-h-[44px] cursor-pointer select-none border-b border-border px-[14px] py-[8px] text-sm transition-colors last:border-b-0 hover:bg-surface',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
          act.dragOver && 'bg-success/15',
          isCut && 'opacity-50',
          isSelected && 'bg-primary/15 text-foreground hover:bg-primary/20',
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
        <div className="flex min-w-0 items-center gap-[10px]">
          {isDir
            ? <Folder className="h-[18px] w-[40px] shrink-0 text-primary-accent" strokeWidth={1.75} aria-hidden="true" />
            : <FileBadgeChip name={node.name} className="shrink-0" />}
          <div className="min-w-0 flex-1">
            {isRenaming ? (
              <VFSRenameInput
                currentName={node.name}
                onConfirm={(name: string) => { onRenameCancel(); void actions.rename(node.path, name); }}
                onCancel={onRenameCancel}
                isDirectory={isDir}
              />
            ) : (
              <span className="block truncate font-medium text-foreground">{node.name}</span>
            )}
            {pendingPeer !== null && <PendingMark peer={pendingPeer} />}
          </div>
        </div>
        <span className="hidden truncate text-muted-foreground md:block">{from ?? '—'}</span>
        <span className="truncate text-right tabular-nums text-muted-foreground">
          {isDir ? folderSummary(node) : formatSize(node.fileMetadata?.fileSize ?? 0)}
        </span>
        <span className="hidden truncate text-muted-foreground md:block">{modified}</span>
        <span className="flex justify-end">{isP2P && <E2ELock />}</span>
      </div>
    </VFSContextMenu>
  );
}
