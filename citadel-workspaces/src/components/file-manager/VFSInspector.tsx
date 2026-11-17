/**
 * The details of the one selected item: a preview, its name and kind, Download
 * (or Open, for a folder) and Share, then what is known about it, and in peer
 * storage the note that it is end-to-end encrypted.
 *
 * A right-hand column on a wide screen; on a phone the same body in a bottom
 * sheet, which is where a tapped file's actions are.
 */
import { ShieldCheck, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import type { RevfsNode } from '@/types/revfs-types';
import { parentPath } from '@/lib/revfs/tree-queries';
import { ItemIcon } from './ItemGlyphs';
import { fileKind } from './vfs-content-helpers';
import { formatSize } from './item-format';
import { folderSummary } from './vfs-item-view';
import { stateConfig } from './vfs-content-helpers';
import { canDownload } from './item-permissions';
import { docsOpenAction } from './docs-file-open';
import type { VFSItemActions } from './vfs-item-actions';

export interface VFSInspectorProps {
  node: RevfsNode;
  actions: VFSItemActions;
  /** Peer storage: the E2E note, naming the peer. */
  peerName: string | null;
  storageName: string;
  from: string | null;
  modified: string;
  onClose: () => void;
}

function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="grid grid-cols-[84px_minmax(0,1fr)] gap-[8px] text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-words text-foreground">{value}</dd>
    </div>
  );
}

function InspectorBody({ node, actions, peerName, storageName, from, modified }: Omit<VFSInspectorProps, 'onClose'>): JSX.Element {
  const isDir: boolean = node.type === 'directory';
  const thumbnail: string | undefined = node.fileMetadata?.thumbnail;
  const state: string | null = node.fileState ? stateConfig[node.fileState].title : null;
  const openInDocs: (() => void) | null = docsOpenAction(actions, node);
  return (
    <div className="flex flex-col gap-[16px] p-[16px]" data-testid="vfs-inspector-body">
      <div className="grid h-[136px] place-items-center rounded-[6px] border border-border bg-surface">
        {thumbnail?.startsWith('data:image/')
          ? <img src={thumbnail} alt="" className="max-h-[120px] max-w-full rounded-[4px] object-contain" />
          : <ItemIcon node={node} size="preview" />}
      </div>
      <div className="min-w-0">
        <p className="break-words text-base font-semibold text-foreground">{node.name}</p>
        <p className="text-xs text-muted-foreground">{isDir ? 'Folder' : fileKind(node.name)}</p>
      </div>
      <div className="grid grid-cols-2 gap-[8px]">
        {openInDocs !== null && (
          <Button size="sm" className="col-span-2 h-[44px]" data-testid="vfs-inspector-open-in-docs" onClick={openInDocs}>Open in Citadel Docs</Button>
        )}
        {isDir
          ? <Button size="sm" className="h-[32px]" onClick={() => actions.openFolder(node.path)}>Open</Button>
          : <Button size="sm" className="h-[32px]" onClick={() => actions.download(node)} disabled={!canDownload(node)} title={canDownload(node) ? undefined : 'Nothing stored to download: this records a transfer.'}>Download</Button>}
        <Button size="sm" variant="outline" className="h-[32px]" onClick={() => actions.share([node])}>Share</Button>
      </div>
      <dl className="flex flex-col gap-[8px] border-t border-border pt-[14px]">
        <Row label={isDir ? 'Contains' : 'Size'} value={isDir ? folderSummary(node) : formatSize(node.fileMetadata?.fileSize ?? 0)} />
        <Row label="Modified" value={modified} />
        {from !== null && <Row label="From" value={from} />}
        <Row label="Location" value={parentPath(node.path)} />
        <Row label="Storage" value={storageName} />
        {state !== null && <Row label="Status" value={state} />}
      </dl>
      {peerName !== null && (
        <p className="flex gap-[10px] rounded-[6px] border border-border bg-surface p-[12px] text-xs text-muted-foreground">
          <ShieldCheck className="h-[16px] w-[16px] shrink-0 text-primary-accent" aria-hidden="true" />
          End-to-end encrypted between you and {peerName}.
        </p>
      )}
    </div>
  );
}

/** The wide-screen column. */
export function VFSInspector(props: VFSInspectorProps): JSX.Element {
  return (
    <aside className="flex w-[300px] shrink-0 flex-col overflow-y-auto border-l border-border bg-card" aria-label="Details" data-testid="vfs-inspector">
      <header className="flex items-center border-b border-border px-[16px] py-[10px]">
        <h2 className="text-sm font-semibold text-foreground">Details</h2>
        <Button variant="ghost" size="icon" className="ml-auto h-[28px] w-[28px]" onClick={props.onClose} aria-label="Close details">
          <X className="h-[14px] w-[14px]" aria-hidden="true" />
        </Button>
      </header>
      <InspectorBody {...props} />
    </aside>
  );
}

/** The phone sheet: the same body, raised from the bottom. */
export function VFSInspectorSheet(props: VFSInspectorProps): JSX.Element {
  return (
    <Sheet open onOpenChange={(open: boolean) => { if (!open) props.onClose(); }}>
      <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-[12px] p-0" data-testid="vfs-inspector" aria-describedby={undefined}>
        <SheetTitle className="px-[16px] pt-[14px] text-sm font-semibold">Details</SheetTitle>
        <InspectorBody {...props} />
      </SheetContent>
    </Sheet>
  );
}
