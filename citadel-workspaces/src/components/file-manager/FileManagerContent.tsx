/**
 * The file manager: the top bar and address bar, the open folder (or a screen
 * saying why there is none), the inspector or bulk bar for the selection, the
 * transfers panel and the status strip.
 *
 * Whose storage and which folder come from the address (useFileManagerPlace);
 * this assembles the parts around them.
 */
import { TreeScope } from "@/types/revfs-types";
import { useFileManagerContent, type UseFileManagerContentResult } from "./useFileManagerContent";
import { useFileManagerView, refreshLabel, type FileManagerView } from './useFileManagerView';
import { ConnectingScreen, LoadingScreen, ErrorScreen, UnknownPeerScreen } from "./FileManagerStatusScreens";
import { fileManagerScreen, type FileManagerScreen } from "./file-manager-screen";
import { uploadAvailability } from "./upload-refusal";
import { FileManagerTopBar } from './FileManagerTopBar';
import { FileManagerAddressBar } from './FileManagerAddressBar';
import { FileManagerBrowser } from './FileManagerBrowser';
import { FileManagerModals } from './FileManagerModals';
import { TransfersPanel } from './TransfersPanel';
import { FileManagerStatusStrip } from './FileManagerStatusStrip';
import { connectedCount } from './storage-peers';
import { itemCountLabel } from './address-bar-model';
import { findNodeByPath } from '@/lib/revfs/tree-operations';
import { parentPath } from '@/lib/revfs/tree-queries';
import { loadCdocRuntime } from '@/lib/cdoc/runtime-loader';
import { browserDocumentFiles } from '@/lib/document-files';
import type { RevfsNode } from '@/types/revfs-types';
import type { ReactNode } from 'react';
import { DocsFileScreen } from './DocsFileScreen';

function OpenedFile({ fm, v, node }: { fm: UseFileManagerContentResult; v: FileManagerView; node: RevfsNode }): JSX.Element {
  const folder: string = parentPath(node.path);
  const folderName: string = folder === '/' ? fm.storageName : folder.slice(folder.lastIndexOf('/') + 1);
  return (
    <DocsFileScreen
      node={node} folderName={folderName} onBack={() => fm.place.openFolder(folder)} onDownload={() => v.actions.download(node)}
      reader={fm.fileReader} loadCdocRuntime={loadCdocRuntime} files={browserDocumentFiles}
    />
  );
}

function Body({ fm, v, shown, footer, opened }: { fm: UseFileManagerContentResult; v: FileManagerView; shown: FileManagerScreen; footer: ReactNode; opened: RevfsNode | null }): JSX.Element {
  if (shown === 'connecting') return <ConnectingScreen />;
  if (shown === 'finding-peers') return <LoadingScreen label="Finding your peers..." />;
  if (shown === 'unknown-peer') return <UnknownPeerScreen storage={fm.storage} onOpenServer={() => fm.place.openStorage({ kind: 'server' })} />;
  if (shown === 'loading') return <LoadingScreen label="Loading file system..." />;
  if (shown === 'error' || !fm.tree) return <ErrorScreen error={fm.error ?? null} onRetry={() => { void fm.refresh(); }} />;
  if (opened !== null) return <OpenedFile fm={fm} v={v} node={opened} />;
  return <FileManagerBrowser fm={fm} v={v} tree={fm.tree} footer={footer} />;
}

export const FileManagerContent: () => JSX.Element = (): JSX.Element => {
  const fm: UseFileManagerContentResult = useFileManagerContent();
  const v: FileManagerView = useFileManagerView(fm);

  const shown: FileManagerScreen = fileManagerScreen({
    myCid: fm.myCid, storage: fm.storage, peersLoading: fm.peersLoading, peerRegistered: fm.peerRegistered,
    treeLoading: fm.loading, hasError: Boolean(fm.error), hasTree: Boolean(fm.tree),
  });
  const browsing: boolean = shown === 'browser' && fm.tree !== null;
  const at: RevfsNode | null = browsing && fm.tree ? findNodeByPath(fm.tree, fm.currentPath) : null;
  // The address names a folder to list, or a file opened in its app.
  const folder: RevfsNode | null = at?.type === 'directory' ? at : null;
  const opened: RevfsNode | null = at?.type === 'file' ? at : null;
  const peerName: string | null = fm.storageMode === TreeScope.Peer && fm.peerRegistered ? fm.storageLabel : null;

  // Under the list, beside the inspector; under everything when there is no list.
  const footer: ReactNode = (
    <>
      {v.transfersOpen && (
        <TransfersPanel rows={v.transfers.rows} active={v.transfers.active} pendingPaths={fm.pendingPaths}
          peerLabel={fm.storageLabel} onClose={() => v.setTransfersOpen(false)} />
      )}
      {browsing && (
        <FileManagerStatusStrip
          connectedPeers={connectedCount(fm.registeredPeers)} storageName={fm.storageName}
          usedBytes={fm.storageUsed} quotaBytes={fm.storageQuota} hostingFor={peerName}
        />
      )}
    </>
  );

  return (
    <div className="flex h-full min-w-0 flex-col bg-background">
      <FileManagerTopBar
        storage={fm.storage} peers={fm.registeredPeers} peersLoading={fm.peersLoading} peerName={peerName}
        onOpenStorage={fm.place.openStorage}
        folder={folder === null ? null : {
          filterText: fm.filterText, onFilterChange: fm.setFilterText,
          onNewFolder: () => v.actions.newFolder(fm.currentPath), onUpload: () => v.actions.upload(fm.currentPath),
          upload: uploadAvailability(fm.currentPath, fm.storageOffer),
        }}
        transfers={{ active: v.transfers.active, open: v.transfersOpen, onToggle: () => v.setTransfersOpen(!v.transfersOpen) }}
      />
      {browsing && opened === null && (
        <FileManagerAddressBar
          tree={fm.tree} path={fm.currentPath} onOpenFolder={fm.place.openFolder} back={fm.place.back} up={fm.place.up}
          countLabel={folder ? itemCountLabel(folder.children ?? []) : null}
          sortField={fm.sortField} sortDirection={fm.sortDirection} onSortChange={fm.handleSortChange}
          view={v.view} onViewChange={v.setView} onRefresh={v.actions.refresh} refreshLabel={refreshLabel(fm.storageMode)}
        />
      )}
      <div className="flex min-h-0 flex-1 flex-col">
        <Body fm={fm} v={v} shown={shown} footer={footer} opened={opened} />
      </div>
      {!browsing && footer}
      <FileManagerModals fm={fm} v={v} />
    </div>
  );
};
