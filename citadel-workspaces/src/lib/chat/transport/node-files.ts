/**
 * A node channel's files: uploaded to the workspace server under the channel's node, then shared
 * by a message naming them, and read back from the server by whoever opens one. Encrypted to the
 * server as the channel's messages are, not end to end (owner decision 4), which the attach
 * control says. There are no transfers to accept or decline: a member offline when it was shared
 * opens it from the server later.
 */
import { readAttachment, sha256Hex, uploadAttachment } from '@/lib/chat/attachments/attachment-wire';
import { declaredMime, type SharedFile } from '@/lib/chat/attachments/shared-file';
import type { NodeChatIO } from './node-chat-io';
import type { FileOpening, FilePort, FileSendReceipt, SendProgress } from './chat-transport';

/** Said beside the attach control: where the file goes, and who can read it. */
export const NODE_FILES_DESTINATION: string = "Stored on the workspace server, readable by this channel's members";

const NO_OFFERS: string = 'A file shared in a channel is kept on the server, so there is no offer to answer.';

export function nodeFiles(io: Pick<NodeChatIO, 'attachments' | 'shareFile' | 'readFile'>, nodeId: string): FilePort {
  const refuse = (): Promise<void> => Promise.reject(new Error(NO_OFFERS));
  return {
    modes: ['server'],
    destination: NODE_FILES_DESTINATION,
    dialogKey: null,
    // No bubble follows the upload, so its progress goes to the caller: nothing stored while it
    // is hashed, then each chunk the server acknowledges.
    send: async (file: File, onProgress: SendProgress): Promise<FileSendReceipt> => {
      const bytes: Uint8Array = await io.readFile(file);
      onProgress(0, bytes.length);
      const id: string = await sha256Hex(bytes);
      await uploadAttachment(io.attachments, nodeId, bytes, id, (stored: number): void => onProgress(stored, bytes.length));
      await io.shareFile({ id, name: file.name, size: bytes.length, mime: declaredMime(file.type) });
      return { outcome: 'shared' };
    },
    accept: refuse,
    decline: refuse,
    cancel: refuse,
    // A node channel's files are read from the server (`read`), never held by this device's agent.
    open: async (): Promise<FileOpening> => ({ kind: 'unknown' }),
    read: (shared: SharedFile): Promise<Uint8Array> => readAttachment(io.attachments, nodeId, shared.id),
  };
}
