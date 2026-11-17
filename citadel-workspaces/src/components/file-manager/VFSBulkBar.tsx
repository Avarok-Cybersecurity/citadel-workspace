/**
 * Two or more selected: the inspector gives way to this bar.
 * Each action applies to the items it can: Download to the files that have bytes
 * to fetch, Move and Delete to what is not a fixed folder; one with nothing to
 * act on is disabled rather than accepted and quietly skipped.
 */
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { RevfsNode } from '@/types/revfs-types';
import { canDelete, canDownload, canModify } from './item-permissions';
import type { VFSItemActions } from './vfs-item-actions';

interface VFSBulkBarProps {
  nodes: RevfsNode[];
  actions: VFSItemActions;
  onClear: () => void;
}

export function VFSBulkBar({ nodes, actions, onClear }: VFSBulkBarProps): JSX.Element {
  const downloadable: RevfsNode[] = nodes.filter(canDownload);
  const movable: RevfsNode[] = nodes.filter(canModify);
  const deletable: RevfsNode[] = nodes.filter(canDelete);
  return (
    <div className="flex flex-wrap items-center gap-[8px] border-b border-border bg-primary/10 px-[16px] py-[8px]" role="toolbar" aria-label="Selected items" data-testid="vfs-bulk-bar">
      <Button variant="ghost" size="icon" className="h-[28px] w-[28px]" onClick={onClear} aria-label="Clear selection">
        <X className="h-[14px] w-[14px]" aria-hidden="true" />
      </Button>
      <span className="mr-[4px] text-sm font-semibold text-foreground" aria-live="polite">{nodes.length} selected</span>
      <Button variant="outline" size="sm" className="h-[28px] bg-card text-sm" disabled={downloadable.length === 0}
        onClick={() => downloadable.forEach((n: RevfsNode) => actions.download(n))}>Download</Button>
      <Button variant="outline" size="sm" className="h-[28px] bg-card text-sm" onClick={() => actions.share(nodes)}>Share</Button>
      <Button variant="outline" size="sm" className="h-[28px] bg-card text-sm" disabled={movable.length === 0}
        onClick={() => actions.moveTo(movable)}>Move to…</Button>
      <Button variant="outline" size="sm" className="ml-auto h-[28px] border-destructive/60 bg-card text-sm text-destructive-emphasis hover:text-destructive-emphasis"
        disabled={deletable.length === 0} onClick={() => actions.remove(deletable)} data-testid="vfs-bulk-delete">Delete</Button>
    </div>
  );
}
