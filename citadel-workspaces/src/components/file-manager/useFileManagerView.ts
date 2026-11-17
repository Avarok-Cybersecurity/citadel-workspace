/**
 * The view's own state -- list or grid, the transfers panel, the Move and Share
 * dialogs -- and the one actions bundle every part of the view acts through.
 * None of it is in the address: a link names a place, not how it is drawn.
 */
import { useCallback, useMemo, useState } from 'react';
import type { RevfsNode } from '@/types/revfs-types';
import { TreeScope } from '@/types/revfs-types';
import { parentPath } from '@/lib/revfs/tree-queries';
import { peerDisplayName } from '@/lib/peer-display';
import type { UseFileManagerContentResult } from './useFileManagerContent';
import type { VFSItemActions } from './vfs-item-actions';
import type { ContentView } from './VFSContentGrid';
import type { ShareSubject } from '@/lib/share/share-target';
import type { FileManagerTarget } from '@/lib/file-manager-location';
import type { StoragePeer } from './storage-peers';
import { selectionPanel, type SelectionPanel } from './selection-panel';
import { useTransfers, type Transfers } from './useTransfers';
import { docsOpenAction } from './docs-file-open';

export interface FileManagerView {
  view: ContentView;
  setView: (view: ContentView) => void;
  transfersOpen: boolean;
  setTransfersOpen: (open: boolean) => void;
  transfers: Transfers;
  moving: RevfsNode[] | null;
  closeMove: () => void;
  /** What the share dialog is open on; null while it is closed. */
  sharing: ShareSubject[] | null;
  closeShare: () => void;
  actions: VFSItemActions;
  panel: SelectionPanel;
  /** Who a CID is, for From columns and transfer rows. */
  nameOf: (cid: bigint) => string;
}

export function useFileManagerView(fm: UseFileManagerContentResult): FileManagerView {
  const [view, setView] = useState<ContentView>('list');
  const [transfersOpen, setTransfersOpen] = useState(false);
  const [moving, setMoving] = useState<RevfsNode[] | null>(null);
  const [sharing, setSharing] = useState<ShareSubject[] | null>(null);
  const { myCid, registeredPeers, place } = fm;

  const nameOf: (cid: bigint) => string = useCallback((cid: bigint): string => {
    if (cid === myCid) return 'You';
    const peer: StoragePeer | undefined = registeredPeers.find((p: StoragePeer): boolean => p.cid === cid);
    return peer?.displayName ?? peerDisplayName({ cid });
  }, [myCid, registeredPeers]);
  const transfers: Transfers = useTransfers(useCallback((cid: string): string => nameOf(BigInt(cid)), [nameOf]));

  const { locate, openFolder, openFile, storage } = place;
  const openInDocs: VFSItemActions['openInDocs'] = useCallback((node: RevfsNode): void => openFile(node.path), [openFile]);
  // Peer storage belongs to a pair: a link to it opens, by default, for the other half.
  const peer: string | null = storage.kind === 'peer' ? registeredPeers.find((p: StoragePeer): boolean => p.cid === storage.cid)?.username ?? null : null;
  const subjectOf: (node: RevfsNode) => ShareSubject | null = useCallback((node: RevfsNode): ShareSubject | null => {
    const folder: boolean = node.type === 'directory';
    const location: FileManagerTarget | null = folder ? locate(node.path, null) : locate(parentPath(node.path), node.name);
    return location === null ? null : { kind: folder ? 'folder' : 'file', location, name: node.name, peer };
  }, [locate, peer]);
  const share: (nodes: RevfsNode[]) => void = useCallback((nodes: RevfsNode[]): void => {
    setSharing(nodes.flatMap((node: RevfsNode): ShareSubject[] => { const s: ShareSubject | null = subjectOf(node); return s === null ? [] : [s]; }));
  }, [subjectOf]);

  const { handleDownload, handleInfo, handleDelete, handleDeleteMultiple, handleRename, handleCut, handleCutMultiple,
    handleCopy, handleCopyMultiple, handlePaste, handleNewFolder, handleUploadFile, handleSync, handleDrop } = fm;

  const actions: VFSItemActions = useMemo((): VFSItemActions => ({
    openFolder,
    openFile: (node: RevfsNode): void => (docsOpenAction({ openInDocs }, node) ?? ((): void => handleDownload(node)))(),
    openInDocs,
    inspect: handleInfo,
    download: handleDownload,
    share,
    moveTo: setMoving,
    // Through the dialog, where a plain or a secure link is chosen and copied.
    copyLink: (node: RevfsNode): void => share([node]),
    remove: (nodes: RevfsNode[]): void => { void (nodes.length === 1 ? handleDelete(nodes[0]) : handleDeleteMultiple(nodes)); },
    rename: handleRename,
    cut: (nodes: RevfsNode[]): void => (nodes.length === 1 ? handleCut(nodes[0]) : handleCutMultiple(nodes)),
    copy: (nodes: RevfsNode[]): void => (nodes.length === 1 ? handleCopy(nodes[0]) : handleCopyMultiple(nodes)),
    paste: handlePaste,
    newFolder: (parent: string): void => { void handleNewFolder(parent); },
    upload: handleUploadFile,
    refresh: (): void => { void handleSync(); },
    drop: (target: string, files: FileList): void => { void handleDrop(target, files); },
  }), [openFolder, openInDocs, handleDownload, handleInfo, share, handleDelete, handleDeleteMultiple, handleRename,
    handleCut, handleCutMultiple, handleCopy, handleCopyMultiple, handlePaste, handleNewFolder, handleUploadFile, handleSync, handleDrop]);

  const panel: SelectionPanel = useMemo((): SelectionPanel => selectionPanel(fm.tree, fm.selectedPaths), [fm.tree, fm.selectedPaths]);

  return {
    view, setView, transfersOpen, setTransfersOpen, transfers,
    moving, closeMove: (): void => setMoving(null),
    sharing, closeShare: (): void => setSharing(null),
    actions, panel, nameOf,
  };
}

/** What Refresh does here, said on its button. */
export function refreshLabel(mode: TreeScope): string {
  return mode === TreeScope.Peer ? 'Sync with peer' : 'Refresh';
}
