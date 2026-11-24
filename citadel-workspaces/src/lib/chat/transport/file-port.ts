/**
 * How a conversation's files leave and come back: the file half of ChatTransport (chat-transport.ts).
 */
import type { FileDetails } from '@/components/layout/sidebar/file-details';
import type { SharedFile } from '@/lib/chat/attachments/shared-file';

/** How a file can leave: to the peer directly (and their storage), to each member directly, or into the server's file store. */
export type FileMode = 'peer' | 'their-storage' | 'members' | 'server';

export interface FileSendReceipt {
  /**
   * `held`: kept until the counterpart is online. `offered`: on its way to be offered, which its
   * bubble follows. `shared`: already stored where the conversation keeps files, and shared.
   */
  readonly outcome: 'held' | 'offered' | 'shared';
}

/** How many of a file's bytes have reached where they are kept, as that place acknowledges them. */
export type SendProgress = (doneBytes: number, totalBytes: number) => void;

/** What opening a received file came to. 'unknown': this device has no record of the file. */
export type FileOpening =
  | { readonly kind: 'downloaded' }
  | { readonly kind: 'unreadable'; readonly reason: string; readonly details: FileDetails }
  | { readonly kind: 'unknown' };

export interface FilePort {
  readonly modes: readonly FileMode[];
  /** Said beside the attach control: where the file goes, and who can read it. */
  readonly destination: string;
  /**
   * `onProgress` hears a send the conversation shows no bubble for (a file the server keeps); a
   * transfer that has a bubble reports its progress there and does not call it.
   */
  send(file: File, onProgress: SendProgress): Promise<FileSendReceipt>;
  accept(transferId: string): Promise<void>;
  decline(transferId: string): Promise<void>;
  cancel(transferId: string): Promise<void>;
  /** The bytes of a file a message shares, read from where the conversation keeps it; null where files are offered, not kept. */
  readonly read: ((file: SharedFile) => Promise<Uint8Array>) | null;
  /**
   * Opens a received file: the browser downloads the original, or, when its bytes cannot be had,
   * the conversation is told why and what is known of it.
   */
  open(transferId: string): Promise<FileOpening>;
  /**
   * The bytes of a file a transfer brought to this device, for an app that opens it in the page;
   * null where transfers are not kept here. Rejects, saying why, when they cannot be had.
   */
  readonly readTransfer: ((transferId: string) => Promise<Uint8Array>) | null;
  /**
   * The one peer the send dialog's own paths (native picker, their storage) address; null in a
   * conversation of many, where the paperclip opens the browser's file picker straight away.
   */
  readonly dialogKey: string | null;
}
