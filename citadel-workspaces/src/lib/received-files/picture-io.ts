/**
 * The browser's PictureCache: the agent socket for received files, IndexedDB for sent ones,
 * the photo decoder's worker, object URLs. Sent pictures are kept as their sends begin (FILE_SENT); this module is loaded by
 * the chat's file bubble, so it listens wherever a send can start.
 */
import type { FileTransfer } from '@/lib/file-transfer/types';
import { eventEmitter } from '@/lib/event-emitter';
import { FILE_TRANSFER_EVENTS, type FileSent } from '@/lib/file-transfer/events';
import { debugLog } from '@/lib/debug-config';
import { browserReceivedFileIO } from './received-file-io';
import { PictureCache } from './picture-load';
import { looksLikePicture } from './image-preview';
import { rememberSentPicture, sentPicture, type SentPictureOf } from './sent-pictures';
import { browserSentPictureStore } from './sent-picture-store';
import { photoDecoder } from '@/lib/photo-decode/photo-decoder-browser';
import { previewGate } from './shared-preview-gate';

export const pictureCache: PictureCache = new PictureCache({
  received: browserReceivedFileIO,
  sent: (transfer: FileTransfer): Promise<Blob | undefined> =>
    sentPicture(browserSentPictureStore, { own: transfer.sender_cid, peer: transfer.recipient_cid, transferId: transfer.id }),
  decode: photoDecoder.decode,
  objectUrl: (blob: Blob): string => URL.createObjectURL(blob),
  release: (url: string): void => URL.revokeObjectURL(url),
}, previewGate);

eventEmitter.on<FileSent>(FILE_TRANSFER_EVENTS.FILE_SENT, ({ transfer, file }: FileSent): void => {
  if (!looksLikePicture(file.name, file.type, file.size)) return;
  const of: SentPictureOf = { own: transfer.sender_cid.toString(), peer: transfer.recipient_cid.toString(), transferId: transfer.id };
  rememberSentPicture(browserSentPictureStore, of, file, Date.now())
    .then((refused: string | null): void => { if (refused !== null) debugLog('SentPictures', `${file.name}: ${refused}`); })
    .catch((error: unknown): void => { console.warn(`[SentPictures] ${file.name} is shown as its thumbnail after a reload: storage refused it`, error); });
});
