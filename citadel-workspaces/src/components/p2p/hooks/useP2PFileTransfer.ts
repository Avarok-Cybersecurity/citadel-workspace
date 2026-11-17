/**
 * useP2PFileTransfer Hook
 *
 * Handles file transfer operations for P2P chat including sending files,
 * accepting/declining transfers, canceling transfers, and opening downloaded files.
 */

import { useCallback, useState } from 'react';
import type { FileDetails } from '@/components/layout/sidebar/file-details';
import { failureDescription } from '@/lib/p2p/peer-failure-detail';
import type { FileOpening, FilePort, FileSendReceipt } from '@/lib/chat/transport/chat-transport';
import { useToast } from '@/hooks/use-toast';
import { debugLog } from '@/lib/debug-config';
import { useServerUpload, type ServerUploadControl, type ServerUploadView } from '@/components/chat/attachments/use-server-upload';

interface UseP2PFileTransferProps {
  /** Null where the conversation carries no files; every action then says so. */
  files: FilePort | null;
  /** Who receives it, as a sentence names them. */
  recipient: string;
}

const NO_FILES: Error = new Error('Files cannot be sent in this conversation');

interface UseP2PFileTransferReturn {
  handleSendFile: (file: File) => Promise<void>;
  handleAcceptTransfer: (transferId: string) => Promise<void>;
  handleDeclineTransfer: (transferId: string) => Promise<void>;
  handleCancelTransfer: (transferId: string) => Promise<void>;
  handleOpenFile: (transferId: string) => void;
  /** The received file whose details are showing, because it could not be opened; or null. */
  openedFile: FileDetails | null;
  /** Why `openedFile` could not be downloaded. */
  openFailure: string | null;
  closeOpenedFile: () => void;
  /** A file going to the server (a node channel), which has no bubble of its own. */
  upload: ServerUploadView;
}

export function useP2PFileTransfer({
  files,
  recipient,
}: UseP2PFileTransferProps): UseP2PFileTransferReturn {
  const { toast } = useToast();
  const { view: upload, move }: ServerUploadControl = useServerUpload();

  const handleSendFile: (file: File) => Promise<void> = useCallback(async (file: File): Promise<void> => {
    // Once the port reports progress, the upload strip carries this send to its end, refusal included.
    let strip: boolean = false;
    try {
      if (files === null) throw NO_FILES;
      // A bubble carries a peer send: preparing, then offered. "File Sent" said it was
      // done while it was still uploading from this tab, and said nothing of a held send.
      const { outcome }: FileSendReceipt = await files.send(file, (storedBytes: number, totalBytes: number): void => {
        strip = true;
        move({ kind: 'uploading', name: file.name, storedBytes, totalBytes });
      });
      if (outcome === 'shared') { move({ kind: 'shared', name: file.name }); return; }
      toast(outcome === 'held'
        ? { title: `Will send ${file.name} when ${recipient} is online`, description: 'Keep this browser open; it goes by itself.' }
        : { title: `Preparing to send ${file.name}`, description: `Keep this tab open until ${recipient} is offered it.` });
    } catch (error) {
      debugLog('UseP2PFileTransfer', 'Failed to send file:', error);
      if (strip) {
        move({ kind: 'refused', name: file.name, reason: failureDescription(error, 'The workspace server did not keep the file.') });
        throw error;
      }
      toast({
        variant: 'destructive',
        title: 'Failed to send file',
        description: failureDescription(error, 'Check your connection and try again.'),
      });
      throw error;
    }
  }, [files, recipient, toast, move]);

  const handleAcceptTransfer: (transferId: string) => Promise<void> = useCallback(async (transferId: string): Promise<void> => {
    try {
      if (files === null) throw NO_FILES;
      await files.accept(transferId);
    } catch (error) {
      debugLog('UseP2PFileTransfer', 'Failed to accept transfer:', error);
      toast({
        variant: 'destructive',
        title: 'Failed to accept file',
        description: failureDescription(error, 'Unknown error'),
      });
    }
  }, [files, toast]);

  // Decline and cancel report failures the same way accept above already did.
  // They used to only debugLog, which is a no-op outside dev — so a decline
  // that failed left the request sitting there with no explanation, and the
  // obvious reading is that the button is broken.
  const handleDeclineTransfer: (transferId: string) => Promise<void> = useCallback(async (transferId: string): Promise<void> => {
    try {
      if (files === null) throw NO_FILES;
      await files.decline(transferId);
    } catch (error) {
      debugLog('UseP2PFileTransfer', 'Failed to decline transfer:', error);
      toast({
        variant: 'destructive',
        title: 'Failed to decline file',
        description: failureDescription(error, 'Unknown error'),
      });
    }
  }, [files, toast]);

  const handleCancelTransfer: (transferId: string) => Promise<void> = useCallback(async (transferId: string): Promise<void> => {
    try {
      if (files === null) throw NO_FILES;
      await files.cancel(transferId);
    } catch (error) {
      debugLog('UseP2PFileTransfer', 'Failed to cancel transfer:', error);
      toast({
        variant: 'destructive',
        title: 'Failed to cancel transfer',
        description: failureDescription(error, 'Unknown error'),
      });
    }
  }, [files, toast]);

  const [openedFile, setOpenedFile] = useState<FileDetails | null>(null);
  const [openFailure, setOpenFailure] = useState<string | null>(null);

  // Like Slack: the browser downloads the original (the transport's `open`). Only when its bytes
  // cannot be had does the chat show what arrived and why it could not be opened.
  const handleOpenFile: (transferId: string) => void = useCallback((transferId: string): void => {
    if (files === null) {
      toast({ variant: 'destructive', title: 'File not known', description: NO_FILES.message });
      return;
    }
    const opening: Promise<void> = files.open(transferId).then((opened: FileOpening): void => {
      if (opened.kind === 'downloaded') return;
      if (opened.kind === 'unknown') {
        toast({ variant: 'destructive', title: 'File not known', description: 'This device has no record of this file.' });
        return;
      }
      setOpenFailure(opened.reason);
      setOpenedFile(opened.details);
    });
    void opening;
  }, [toast, files]);

  return {
    handleSendFile,
    handleAcceptTransfer,
    handleDeclineTransfer,
    handleCancelTransfer,
    handleOpenFile,
    openedFile,
    openFailure,
    closeOpenedFile: (): void => { setOpenedFile(null); setOpenFailure(null); },
    upload,
  };
}
