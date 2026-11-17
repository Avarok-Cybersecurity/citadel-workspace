import { useState, useRef, useCallback, useEffect, type RefObject, type DragEvent } from 'react';
import { formatBytes } from '@/lib/format-bytes';
import { fileTransferService } from '@/lib/file-transfer';
import { useSendCeiling, type SendCeiling } from './hooks/use-send-ceiling';
import { toast } from 'sonner';
import { browserSendCeiling, browserSendRefusal } from '@/lib/file-transfer/staged-upload/send-route';
import { debugLog } from '@/lib/debug-config';
import { failureDescription } from '@/lib/p2p/peer-failure-detail';
import { sharedStorageRefusal } from '@/lib/revfs/send-to-their-storage';
import { sendToTheirStorageNow } from '@/lib/revfs/send-to-their-storage-io';

interface UseFileTransferOptions {
  onClose: () => void;
  onSendFile: (file: File) => Promise<void>;
  peerCid: string;
  /** Whether the dialog is showing: the agent is asked again each time it opens. */
  isOpen: boolean;
}

export interface UseFileTransferResult {
  selectedFile: File | null;
  previewUrl: string | null;
  isDragging: boolean;
  isSending: boolean;
  isPickingFile: boolean;
  error: string | null;
  nativePickerAvailable: false | null;
  fileInputRef: RefObject<HTMLInputElement>;
  /** The largest file the agent takes from this browser; null until it has said. */
  maxFileSizeBytes: number | null;
  /** Why the agent could not be asked, or null. */
  ceilingFailure: string | null;
  isStoring: boolean;
  formatBytes: (bytes: number) => string;
  handleDrop: (e: React.DragEvent) => void;
  handleDragOver: (e: React.DragEvent) => void;
  handleDragLeave: (e: React.DragEvent) => void;
  handleInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleBrowseClick: () => void;
  handleNativePickerClick: () => Promise<void>;
  handleRemoveFile: () => void;
  handleSend: () => Promise<void>;
  /** Why the chosen file cannot go to shared storage, or null when it can. */
  storageRefusal: string | null;
  handleSendToStorage: () => Promise<void>;
  handleClose: () => void;
}

export function useFileTransfer({
  onClose,
  onSendFile,
  peerCid,
  isOpen,
}: UseFileTransferOptions): UseFileTransferResult {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isPickingFile, setIsPickingFile] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerRefused, setNativePickerAvailable] = useState<false | null>(null);
  const fileInputRef: RefObject<HTMLInputElement> = useRef<HTMLInputElement>(null);

  // The one ceiling on a chosen or dropped file is the agent's
  // (staged-upload/send-route.ts): 2 GB through an agent that stages uploads,
  // 16 MiB inline through an older one. A file chosen before the agent has said
  // waits for the answer instead of being judged against a guess.
  const ceiling: SendCeiling = useSendCeiling(isOpen);
  // Hidden once the agent's greeting says it has no picker, or the picker has refused; unknown is offered.
  const nativePickerAvailable: false | null = ceiling.nativePicker === false ? false : pickerRefused;
  const stagesUploads: boolean | null = ceiling.stagesUploads;
  const maxFileSizeBytes: number | null = stagesUploads === null ? null : browserSendCeiling(stagesUploads);
  const [waitingFile, setWaitingFile] = useState<File | null>(null);
  const [isStoring, setIsStoring] = useState<boolean>(false);

  const handleRemoveFile = (): void => {
    setSelectedFile(null);
    setPreviewUrl(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleFileSelect: (file: File) => void = useCallback((file: File): void => {
    setError(null);

    if (stagesUploads === null) {
      setWaitingFile(file);
      return;
    }
    const refusal: string | null = browserSendRefusal(file, stagesUploads, nativePickerAvailable !== false);
    if (refusal !== null) {
      setError(refusal);
      return;
    }

    setSelectedFile(file);

    if (file.type.startsWith('image/')) {
      const reader: FileReader = new FileReader();
      reader.onload = (e): void => {
        setPreviewUrl(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    } else {
      setPreviewUrl(null);
    }
  }, [stagesUploads, nativePickerAvailable]);

  useEffect((): void => {
    if (waitingFile === null || stagesUploads === null) return;
    setWaitingFile(null);
    handleFileSelect(waitingFile);
  }, [waitingFile, stagesUploads, handleFileSelect]);

  const handleDrop: (e: React.DragEvent) => void = useCallback((e: React.DragEvent): void => {
    e.preventDefault();
    setIsDragging(false);

    const files: FileList = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileSelect(files[0]);
    }
  }, [handleFileSelect]);

  const handleDragOver: (e: React.DragEvent) => void = useCallback((e: React.DragEvent): void => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave: (e: React.DragEvent) => void = useCallback((e: React.DragEvent): void => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const files: FileList | null = e.target.files;
    if (files && files.length > 0) {
      handleFileSelect(files[0]);
    }
  };

  const handleBrowseClick = (): void => {
    fileInputRef.current?.click();
  };

  const handleNativePickerClick: () => Promise<void> = useCallback(async (): Promise<void> => {
    setError(null);
    setIsPickingFile(true);

    try {
      const transferId: string = await fileTransferService.sendFileWithNativePicker(
        peerCid,
        'Select a file to send',
        undefined
      );

      debugLog('FileTransferModal', 'Native file transfer started', { transferId });
      handleRemoveFile();
      onClose();
    } catch (err) {
      const errorMessage: string = err instanceof Error ? err.message : 'Failed to pick file';

      if (errorMessage.includes('native-dialogs feature is disabled') ||
          errorMessage.includes('File picker not available')) {
        setNativePickerAvailable(false);
        setError('Native file picker not available in this environment. Use drag & drop or browse instead.');
      } else if (errorMessage.includes('cancelled') || errorMessage.includes('canceled')) {
        debugLog('FileTransferModal', 'File picker cancelled');
      } else {
        setError(errorMessage);
      }
    } finally {
      setIsPickingFile(false);
    }
  }, [peerCid, onClose]);

  const handleSend = async (): Promise<void> => {
    if (!selectedFile) return;

    setIsSending(true);
    setError(null);

    try {
      await onSendFile(selectedFile);
      handleRemoveFile();
      onClose();
    } catch (err) {
      // Measured live: the WASM client rejected with a non-Error, and the dialog said only
      // "Failed to send file". The same translation the toast uses, so both say why.
      setError(failureDescription(err, 'Failed to send file. Check your connection and try again.'));
    } finally {
      setIsSending(false);
    }
  };

  // A separate action, not a way of sending: see lib/revfs/send-to-their-storage.
  const storageRefusal: string | null = selectedFile ? sharedStorageRefusal(selectedFile) : null;
  const handleSendToStorage = async (): Promise<void> => {
    if (!selectedFile || storageRefusal !== null) return;
    setIsStoring(true);
    setError(null);
    try {
      const stored: boolean = await sendToTheirStorageNow(BigInt(peerCid), selectedFile);
      if (!stored) throw new Error('Their agent did not confirm it stored the file; it was not added.');
      // Said, not just closed (UX review, finding 3).
      toast.success(`Put ${selectedFile.name} in your shared storage`, { description: 'Find it in the File Manager.' });
      handleRemoveFile();
      onClose();
    } catch (err) {
      setError(failureDescription(err, 'Could not put the file in shared storage.'));
    } finally {
      setIsStoring(false);
    }
  };

  const handleClose = (): void => {
    if (!isSending && !isStoring) {
      handleRemoveFile();
      onClose();
    }
  };

  return {
    selectedFile,
    previewUrl,
    isDragging,
    isSending,
    isPickingFile,
    error,
    nativePickerAvailable,
    fileInputRef,
    maxFileSizeBytes,
    ceilingFailure: ceiling.failure,
    isStoring,
    formatBytes,
    handleDrop,
    handleDragOver,
    handleDragLeave,
    handleInputChange,
    handleBrowseClick,
    handleNativePickerClick,
    handleRemoveFile,
    handleSend,
    storageRefusal,
    handleSendToStorage,
    handleClose,
  };
}
