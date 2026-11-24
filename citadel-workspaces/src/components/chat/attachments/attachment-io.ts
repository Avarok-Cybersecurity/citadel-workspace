/**
 * What a shared file's card does outside itself: read the file's bytes from where the
 * conversation keeps it, and hand them to the person as a download. Provided by the chat pane
 * from its transport; absent (null) where files are offered rather than kept.
 */
import { createContext } from 'react';
import type { SharedFile } from '@/lib/chat/attachments/shared-file';
import type { DocumentFiles } from '@/lib/document-files';
import type { FileMode } from '@/lib/chat/transport/chat-transport';

export interface AttachmentIO {
  read(file: SharedFile): Promise<Uint8Array>;
  readonly files: Pick<DocumentFiles, 'save'>;
  /** Where the conversation keeps its files, as the card says it ("on the workspace server"). */
  readonly where: string;
}

/** Where files are kept, from how they leave (FilePort `modes`): this device, or the server. */
export function keptWhere(modes: readonly FileMode[]): string {
  return modes.includes('device') ? 'on this device' : 'on the workspace server';
}

export const AttachmentIOContext: React.Context<AttachmentIO | null> = createContext<AttachmentIO | null>(null);

/**
 * The bytes of a file a transfer brought to this device (FilePort.readTransfer), for an app that
 * opens a transfer's file; null where the conversation keeps no transfers here.
 */
export type TransferReader = (transferId: string) => Promise<Uint8Array>;

export const TransferReaderContext: React.Context<TransferReader | null> = createContext<TransferReader | null>(null);
