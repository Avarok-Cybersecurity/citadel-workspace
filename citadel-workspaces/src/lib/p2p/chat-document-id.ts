/**
 * Which editor a chat document's id names. A document made in a chat from this release on is a
 * Citadel Docs document and its id says so (`cdoc-` and a UUID); every earlier one is a bare
 * UUID made by the old chat editor, moved to Citadel Docs once per device when it is opened.
 *
 * The id, not a field beside it: it is the one part of the invitation every path carries. The
 * agent that keeps a conversation for its accounts stores and sends the fields it knows (the
 * document's id and title) and drops any other, so a format field would vanish on that path and
 * the recipient would take a new document for an old one.
 */
const CDOC_PREFIX: 'cdoc-' = 'cdoc-';

export type ChatDocumentFormat = 'cdoc' | 'earlier-editor';

export function newChatDocumentId(): string {
  return `${CDOC_PREFIX}${crypto.randomUUID()}`;
}

export function chatDocumentFormat(docId: string): ChatDocumentFormat {
  return docId.startsWith(CDOC_PREFIX) ? 'cdoc' : 'earlier-editor';
}
