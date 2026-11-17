/**
 * Chat documents that are not open still hear their peer: an edit or a rename arriving while
 * the document is closed is recorded on this device (lib/cdoc/chat/chat-inbox.ts), so it
 * opens with it even when the peer is offline by then. Only the kinds that carry something to
 * record load the recorder, and it loads on the first one, so the messenger's chunk carries
 * only this filter.
 */
import { CDOC_CHAT_COMMAND_EVENT, type CdocChatCommandEvent } from '@/types/cdoc-chat-sync';
import { errorLog } from '@/lib/debug-config';

const RECORDED_KINDS: ReadonlySet<string> = new Set<string>(['update', 'diff', 'rename']);

export function bindChatDocumentInbox(listen: (event: string, handler: (data: CdocChatCommandEvent) => void) => void): void {
  listen(CDOC_CHAT_COMMAND_EVENT, (event: CdocChatCommandEvent): void => {
    if (event.recipientCid === undefined || !RECORDED_KINDS.has(event.payload.sync.kind)) return;
    import('@/lib/cdoc/chat/chat-inbox').then(
      ({ recordForClosedDocument }): void => recordForClosedDocument(event),
      (error: unknown): void => errorLog('ChatDocumentInbox', 'The chat document recorder did not load:', error),
    );
  });
}
