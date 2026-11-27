/**
 * Chat documents that are not open still hear their peer: an edit or a rename arriving while
 * the document is closed is recorded on this device (lib/cdoc/chat/chat-inbox.ts, by way of chat-app-ports.ts), so it
 * opens with it even when the peer is offline by then. A picture the peer asks for is answered
 * from this device, and one it announces is fetched to it (lib/cdoc/pictures/app-pair-pictures.ts).
 * Only the kinds that carry something to act on load their handler, on the first one, so the
 * messenger's chunk carries only this filter.
 */
import { CDOC_CHAT_COMMAND_EVENT, type CdocChatCommandEvent } from '@/types/cdoc-chat-sync';
import { errorLog } from '@/lib/debug-config';

const RECORDED_KINDS: ReadonlySet<string> = new Set<string>(['update', 'diff', 'rename']);
/** The peer asks for a picture or announces one: answered here whether or not the document is open (a chunk or a none goes to the ask waiting for it). */
const PICTURE_KINDS: ReadonlySet<string> = new Set<string>(['picture_want', 'picture_have']);

export function bindChatDocumentInbox(listen: (event: string, handler: (data: CdocChatCommandEvent) => void) => void): void {
  listen(CDOC_CHAT_COMMAND_EVENT, (event: CdocChatCommandEvent): void => {
    if (event.recipient_cid === undefined) return;
    if (PICTURE_KINDS.has(event.payload.sync.kind)) {
      import('@/lib/cdoc/pictures/app-pair-pictures').then(
        ({ heardPictureCommand }): void => heardPictureCommand(event),
        (error: unknown): void => errorLog('ChatDocumentInbox', 'The chat document pictures did not load:', error),
      );
      return;
    }
    if (!RECORDED_KINDS.has(event.payload.sync.kind)) return;
    import('@/lib/cdoc/chat/chat-app-ports').then(
      ({ recordForClosedDocument }): void => recordForClosedDocument(event),
      (error: unknown): void => errorLog('ChatDocumentInbox', 'The chat document recorder did not load:', error),
    );
  });
}
