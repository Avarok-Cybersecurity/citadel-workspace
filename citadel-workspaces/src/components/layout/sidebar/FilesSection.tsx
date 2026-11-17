import { FileSpreadsheet, FileText, FileType, FileCode, Folder, FileX } from "lucide-react";
import { mayLeaveEditor } from '@/lib/leave-editor';
import { useConfirm } from '@/components/shared/confirm-dialog';
import { formatBytes } from '@/lib/format-bytes';
import { useRegisteredPeers } from '@/hooks';
import { useState, useEffect, useCallback, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "@/components/ui/sidebar";
import { FilePreviewDialog } from "./FilePreviewDialog";
import { useNavigate, useLocation } from "react-router-dom";
import { fileManagerHref } from "@/lib/file-manager-location";
import { fileTransferService, FILE_TRANSFER_EVENTS, type FileTransfer } from "@/lib/file-transfer";
import { useEventListeners } from "@/hooks";
import { transferDetails, revfsDownloadDetails, newestFirst, type FileDetails } from './file-details';
import { revfsDownloadHistory, REVFS_DOWNLOAD_EVENTS, type RevfsDownloadRecord } from '@/lib/revfs/download-history';
import { getCurrentCid } from '@/lib/p2p/current-cid';
import { debugLog } from '@/lib/debug-config';
import type { NavigateFunction } from 'react-router';

const getFileIcon: (fileName: string) => JSX.Element = (fileName: string): JSX.Element => {
  const extension: string | undefined = fileName.split('.').pop()?.toLowerCase();

  switch (extension) {
    case 'xlsx':
    case 'xls':
      return <FileSpreadsheet className="h-4 w-4" />;
    case 'pdf':
      return <FileType className="h-4 w-4" />;
    case 'md':
    case 'mdx':
    case 'txt':
    case 'doc':
    case 'docx':
    case 'odt':
      return <FileText className="h-4 w-4" />;
    default:
      return <FileCode className="h-4 w-4" />;
  }
};

export const FilesSection: () => JSX.Element = (): JSX.Element => {
  const [files, setFiles] = useState<FileDetails[]>([]);
  const [selectedFile, setSelectedFile] = useState<FileDetails | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const { registeredPeers } = useRegisteredPeers();
  const confirm: ReturnType<typeof useConfirm> = useConfirm();
  const navigate: NavigateFunction = useNavigate();
  const location: ReturnType<typeof useLocation> = useLocation();

  /**
   * What reached this agent: completed incoming transfers, and files this
   * account pulled back out of RE-VFS storage. The second source was missing,
   * so a pull that landed on disk left this list saying "No downloaded files
   * yet".
   *
   * `latest` drops an answer overtaken by a newer load, so a slow history read
   * cannot write a stale list over a fresh one.
   */
  const latest: React.MutableRefObject<number> = useRef<number>(0);
  const loadFiles: () => Promise<void> = useCallback(async (): Promise<void> => {
    const ticket: number = ++latest.current;
    const usernameForCid = (cid: string): string | undefined =>
      registeredPeers.find(peer => peer.cid.toString() === cid)?.username;
    const transfers: FileTransfer[] = fileTransferService.getAllTransfers()
      .filter(t => t.state === 'complete' && t.isIncoming);

    let pulls: RevfsDownloadRecord[] = [];
    try {
      const owner: bigint | null = await getCurrentCid();
      if (owner !== null) pulls = await revfsDownloadHistory.list(owner);
    } catch (error: unknown) {
      // The transfers are still worth showing when the history cannot be read.
      debugLog('FilesSection', 'RE-VFS download history unreadable:', error);
    }
    if (ticket !== latest.current) return;
    setFiles(newestFirst([
      ...transfers.map(t => transferDetails(t, usernameForCid)),
      ...pulls.map(revfsDownloadDetails),
    ]));
  }, [registeredPeers]);

  // Initial load
  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  // Subscribe to file transfer completion and state change events
  useEventListeners(
    [FILE_TRANSFER_EVENTS.COMPLETED, FILE_TRANSFER_EVENTS.STATE_CHANGED, REVFS_DOWNLOAD_EVENTS.RECORDED],
    (): void => { void loadFiles(); }
  );

  // Also refresh on window focus in case events were missed while tab was inactive
  useEffect(() => {
    const handleVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') {
        void loadFiles();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return (): void => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [loadFiles]);

  const handleFileClick = (file: FileDetails): void => {
    setSelectedFile(file);
    setIsPreviewOpen(true);
  };

  const handleClosePreview = (): void => {
    setIsPreviewOpen(false);
    setSelectedFile(null);
  };

  const params: URLSearchParams = new URLSearchParams(location.search);
  const isFileManagerActive: boolean = params.get('section') === 'files';

  const handleFileManagerClick = async (): Promise<void> => {
    // Deletes nodeId from the URL, which unmounts the editor.
    if (!(await mayLeaveEditor(confirm))) return;

    // The server, at the top level: the button names no member, so it opens
    // nobody's storage but your own. It used to open the first registered peer's.
    navigate(fileManagerHref(location.search, { storage: { kind: 'server' }, path: '/', item: null, via: null }));
  };

  return (
    <>
      <SidebarGroup className="flex-shrink-0 min-h-[4rem]" data-testid="files-section">
        <SidebarGroupLabel className="text-primary-accent font-semibold px-0 ml-3">FILES</SidebarGroupLabel>
        <SidebarGroupContent>
          <ScrollArea className="max-h-[30vh]">
            <SidebarMenu>
              {files.length === 0 ? (
                <SidebarMenuItem>
                  <div
                    className="px-3 py-2 text-sm text-muted-foreground flex items-center gap-2"
                    data-testid="no-files-message"
                  >
                    <FileX className="h-4 w-4" />
                    <span>No downloaded files yet</span>
                  </div>
                </SidebarMenuItem>
              ) : (
                files.map((file) => (
                  <SidebarMenuItem key={file.id} data-testid={`file-item-${file.id}`}>
                    <SidebarMenuButton
                      className="text-foreground hover:bg-primary-accent/15 hover:text-foreground transition-colors"
                      onClick={() => handleFileClick(file)}
                    >
                      {getFileIcon(file.name)}
                      <span className="truncate" title={`${file.name} (${formatBytes(file.size)})`}>
                        {file.name}
                      </span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))
              )}
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={isFileManagerActive}
                  // White belongs on a primary fill, not on the page: see selected-states-do-not-borrow-a-solid-fills-foreground.test.ts.
                  className={`text-foreground hover:bg-primary-accent/15 hover:text-foreground transition-colors ${
                    isFileManagerActive ? "bg-primary-accent/20 text-primary-accent" : ""
                  }`}
                  onClick={() => void handleFileManagerClick()}
                  data-testid="file-manager-button"
                >
                  <Folder className="h-4 w-4" />
                  <span>File Manager</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </ScrollArea>
        </SidebarGroupContent>
      </SidebarGroup>

      <FilePreviewDialog
        file={selectedFile}
        isOpen={isPreviewOpen}
        onClose={handleClosePreview}
        failure={null}
      />
    </>
  );
};
