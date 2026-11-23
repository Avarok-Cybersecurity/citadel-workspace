/**
 * What a shared file's card does outside itself: read the file's bytes from where the
 * conversation keeps it, and hand them to the person as a download. Provided by the chat pane
 * from its transport; absent (null) where files are offered rather than kept.
 */
import { createContext } from 'react';
import type { SharedFile } from '@/lib/chat/attachments/shared-file';
import type { DocumentFiles } from '@/lib/document-files';

export interface AttachmentIO {
  read(file: SharedFile): Promise<Uint8Array>;
  readonly files: Pick<DocumentFiles, 'save'>;
}

export const AttachmentIOContext: React.Context<AttachmentIO | null> = createContext<AttachmentIO | null>(null);

/**
 * The bytes of a file a transfer brought to this device (FilePort.readTransfer), for an app that
 * opens a transfer's file; null where the conversation keeps no transfers here.
 */
export type TransferReader = (transferId: string) => Promise<Uint8Array>;

export const TransferReaderContext: React.Context<TransferReader | null> = createContext<TransferReader | null>(null);
