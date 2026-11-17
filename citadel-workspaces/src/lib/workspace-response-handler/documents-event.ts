/**
 * The event the workspace response handler emits for every documents answer this tab receives,
 * a page's (`Documents`) or a chat document's (`ChatDocuments`), and cdoc/collab/documents-transport.ts
 * listens to. Kept free of imports beyond the types, so the response handler takes nothing else
 * from the collaboration code.
 */
import { isVariant, type DocumentsResponse, type WorkspaceProtocolResponse } from 'citadel-workspace-client-ts';

export const DOCUMENTS_EVENT: 'workspace:documents' = 'workspace:documents';

export interface DocumentsEvent {
  readonly answer: DocumentsResponse;
  /** The chat document it is about, or null for the node's page. */
  readonly chatDoc: string | null;
}

/** Null for a response that is no document's. */
export function documentsEventOf(response: WorkspaceProtocolResponse): DocumentsEvent | null {
  if (isVariant(response, 'Documents')) return { answer: response.Documents, chatDoc: null };
  if (isVariant(response, 'ChatDocuments')) return { answer: response.ChatDocuments.answer, chatDoc: response.ChatDocuments.chat_doc };
  return null;
}
