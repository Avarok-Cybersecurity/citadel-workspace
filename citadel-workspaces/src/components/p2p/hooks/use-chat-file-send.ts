import { useRef, useState, type RefObject } from 'react';
import { useP2PFileTransfer } from './useP2PFileTransfer';
import { dropUnavailableReason } from '../drop-unavailable';
import type { FilePort } from '@/lib/chat/transport/chat-transport';

type FileTransfer = ReturnType<typeof useP2PFileTransfer>;

export interface ChatFileSend {
  /** Transfers and their actions, for the message list. */
  fileTransfer: FileTransfer;
  dialogOpen: boolean;
  /** The send dialog where one peer is addressed; the browser's picker (`pickerRef`) otherwise. */
  openDialog: () => void;
  /** The file input a conversation of many picks from, clicked within the paperclip's own press. */
  pickerRef: RefObject<HTMLInputElement>;
  closeDialog: () => void;
  /** Props for the conversation's drop target. */
  drop: { onFile: (file: File) => void; unavailable: string | null };
}

/**
 * How a file leaves this conversation: the paperclip's dialog and a file dropped on the chat are
 * two doors to one send entry (`handleSendFile`). The hook has already toasted a failure, so the
 * drop only swallows the rejection, it does not hide it.
 */
export function useChatFileSend(params: { files: FilePort | null; recipient: string; viewingDocument: boolean; paused: boolean }): ChatFileSend {
  const fileTransfer: FileTransfer = useP2PFileTransfer({ files: params.files, recipient: params.recipient });
  const [dialogOpen, setDialogOpen] = useState<boolean>(false);
  const pickerRef: RefObject<HTMLInputElement> = useRef<HTMLInputElement>(null);
  return {
    fileTransfer,
    dialogOpen,
    pickerRef,
    // Synchronous: a browser opens its picker only inside the user's own click.
    openDialog: (): void => { if (params.files?.dialogKey === null) pickerRef.current?.click(); else setDialogOpen(true); },
    closeDialog: (): void => setDialogOpen(false),
    drop: {
      onFile: (file: File): void => { fileTransfer.handleSendFile(file).catch((): void => {}); },
      unavailable: dropUnavailableReason({ carriesFiles: params.files !== null, viewingDocument: params.viewingDocument, paused: params.paused }),
    },
  };
}
