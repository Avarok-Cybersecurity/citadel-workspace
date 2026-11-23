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
import { toast } from 'sonner';
import { activateFile, openersOfNode } from './file-openers';
import type { FileOpener, Openers } from '@/lib/citadel-apps/openers/openers';
import { extensionOf } from '@/lib/citadel-apps/openers/file-extension';
import { openInInstalled } from '@/lib/citadel-apps/openers/open-installed';
import { useFileOpeners, type FileOpeners } from '@/lib/citadel-apps/openers/file-openers-context';

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
  const openers: FileOpeners = useFileOpeners();
  const { available, lastChoices, installed } = openers;
  const { fileReader } = fm;
  // A page app opens the file at its own address, so Back returns to its folder; an installed app
  // is handed it and shown in its tab.
  const openIn: VFSItemActions['openIn'] = useCallback((app: FileOpener, node: RevfsNode): void => {
    lastChoices.choose(extensionOf(node.name), app.id);
    if (app.kind === 'page') { openFile(node.path); return; }
    if (installed === null) return;
    openInInstalled(app, { name: node.name, mime: '' }, (): Promise<Uint8Array> => fileReader.read(node), installed).then((why: string | null): void => {
      if (why !== null) toast.error(`${node.name} was not opened: ${why}.`);
    }, (error: unknown): void => {
      toast.error(`${node.name} could not be read for ${app.name}: ${error instanceof Error ? error.message : String(error)}`);
    });
  }, [openFile, lastChoices, fileReader, installed]);
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

  const actions: VFSItemActions = useMemo((): VFSItemActions => {
    const openersOf = (node: RevfsNode): Openers | null => openersOfNode(node, available, lastChoices.of(extensionOf(node.name)));
    return {
      openFolder,
      openFile: (node: RevfsNode): void => activateFile(node, { openersOf, openIn, download: handleDownload }, (notice: string): void => { toast.info(notice); }),
      openersOf,
      openIn,
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
    };
  }, [available, lastChoices, openFolder, openIn, handleDownload, handleInfo, share, handleDelete, handleDeleteMultiple, handleRename,
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
