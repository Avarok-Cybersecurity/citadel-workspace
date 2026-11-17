/**
 * The open folder and what is selected in it: the list or grid, with the bulk
 * bar over it for several items, or the inspector beside it for one -- beside on
 * a wide screen, a bottom sheet on a phone.
 */
import type { ReactNode } from 'react';
import type { RevfsNode } from '@/types/revfs-types';
import { TreeScope } from '@/types/revfs-types';
import { useIsMobile } from '@/hooks/use-mobile';
import { useMotionTier } from '@/hooks/use-motion-tier';
import { cn } from '@/lib/utils';
import { uploadAvailability } from './upload-refusal';
import { VFSContentGrid } from './VFSContentGrid';
import { VFSBulkBar } from './VFSBulkBar';
import { VFSInspector, VFSInspectorSheet, type VFSInspectorProps } from './VFSInspector';
import { formatModified } from './item-format';
import type { UseFileManagerContentResult } from './useFileManagerContent';
import type { FileManagerView } from './useFileManagerView';

interface FileManagerBrowserProps {
  fm: UseFileManagerContentResult;
  v: FileManagerView;
  tree: RevfsNode;
  /** The transfers panel and status strip, which belong under the list. */
  footer: ReactNode;
}

export function FileManagerBrowser({ fm, v, tree, footer }: FileManagerBrowserProps): JSX.Element {
  const phone: boolean = useIsMobile();
  // A fade, which Lite keeps; only Off drops it.
  const motion: boolean = useMotionTier() !== 'off';
  const now: number = Date.now();
  const isP2P: boolean = fm.storageMode === TreeScope.Peer;
  const { panel } = v;

  const inspected: VFSInspectorProps | null = panel.kind !== 'inspector' ? null : {
    node: panel.node, actions: v.actions,
    peerName: isP2P ? fm.storageLabel : null, storageName: fm.storageName,
    from: panel.node.fileMetadata ? v.nameOf(panel.node.fileMetadata.uploadedByCid) : null,
    modified: formatModified(panel.node.updatedAt, now, undefined),
    onClose: fm.clearSelection,
  };

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        {panel.kind === 'bulk' && <VFSBulkBar nodes={panel.nodes} actions={v.actions} onClear={fm.clearSelection} />}
        {fm.missingItem !== null && (
          <p className="border-b border-border bg-warning/10 px-[16px] py-[8px] text-sm text-foreground" role="status" data-testid="vfs-missing-item">
            &ldquo;{fm.missingItem}&rdquo; is not in this folder any more. It may have been renamed, moved or deleted.
          </p>
        )}
        <VFSContentGrid
          tree={tree} currentPath={fm.currentPath} view={v.view} actions={v.actions} isP2P={isP2P} storageName={fm.storageName}
          pendingPaths={fm.pendingPaths} peerLabel={fm.storageLabel} cutItemPaths={fm.cutItemPaths} hasPasteItems={fm.hasPasteItems}
          selectedPaths={fm.selectedPaths} onSelect={fm.selectItem} onSelectAll={fm.handleSelectAll} onClearSelection={fm.clearSelection}
          sortField={fm.sortField} sortDirection={fm.sortDirection} filterText={fm.filterText} onClearFilter={() => fm.setFilterText('')}
          upload={uploadAvailability(fm.currentPath, fm.storageOffer)} nameOf={v.nameOf} now={now}
        />
        {footer}
      </div>
      {inspected !== null && !phone && (
        <div className={cn('flex min-h-0', motion && 'animate-fade-in')}><VFSInspector {...inspected} /></div>
      )}
      {inspected !== null && phone && <VFSInspectorSheet {...inspected} />}
    </div>
  );
}
