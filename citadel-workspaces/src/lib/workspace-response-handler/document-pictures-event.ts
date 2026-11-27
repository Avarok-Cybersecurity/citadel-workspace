/**
 * The event the workspace response handler emits for every document picture answer this tab
 * receives (a chunk stored, a chunk read, a refusal), which lib/cdoc/pictures/server-pictures.ts
 * listens to. Not raw and not logged: the bytes are a picture in a member's document.
 */
import { eventEmitter } from '@/lib/event-emitter';
import { isVariant, type DocumentPicturesResponse, type WorkspaceProtocolResponse } from 'citadel-workspace-client-ts';

export const DOCUMENT_PICTURES_EVENT: 'workspace:document-pictures' = 'workspace:document-pictures';

/** Emits the answer when `response` is one; whether it was. */
export function emitDocumentPictures(response: WorkspaceProtocolResponse): boolean {
  if (!isVariant(response, 'DocumentPictures')) return false;
  const answer: DocumentPicturesResponse = response.DocumentPictures;
  eventEmitter.emit(DOCUMENT_PICTURES_EVENT, answer);
  return true;
}
