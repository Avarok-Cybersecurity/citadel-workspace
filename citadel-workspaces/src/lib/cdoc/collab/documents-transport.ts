/**
 * The production DocumentsTransport: this tab's workspace session, through the same
 * `sendProtocolRequest` path every workspace request takes (WorkspaceProtocolRequest::Documents
 * inscribed in InternalServiceRequest::Message), with answers off the response handler.
 *
 * Multi-tab: the server's answers and pushes reach this tab inside a MessageNotification
 * addressed to the session's cid, which routing-rules.ts routes by cid to every tab holding
 * the session (route-by-cid.ts). So each tab's DocumentSession sees its session's whole
 * Documents traffic, including the `Appended` answers of another tab of the same account; the
 * session tells its own by `client_seq`.
 *
 * A chat document's session (`chatDoc` set) sends its requests inside the `ChatDocuments`
 * envelope and hears only the answers addressed to that document; a page's hears only the
 * page's. Without that split a page would take a chat document's updates, which name the same
 * node, for its own. Its refusals, the channel's denial too, come addressed in the envelope, so
 * it hears no plain `Error`: none of those is about a chat document.
 */
import type { DocumentsRequest } from 'citadel-workspace-client-ts';
import { eventEmitter } from '@/lib/event-emitter';
import type { ProtocolSender } from '@/lib/workspace-service/workspace-operations';
import { readAgentReconnectEvent, type AgentReconnectEvent } from '@/types/agent-reconnect';
import { reconnectingTo } from '@/lib/reconnect/server-reconnect';
import { DOCUMENTS_EVENT, type DocumentsEvent } from '@/lib/workspace-response-handler/documents-event';
import type { DocumentsTransport, LinkState } from './ports';

export function workspaceDocumentsTransport(sender: ProtocolSender, chatDoc: string | null): DocumentsTransport {
  const selfCid: bigint | null = sender.currentCid;
  if (selfCid === null) throw new Error('A document can be opened only in a signed-in session');
  return {
    selfCid,
    send: (request: DocumentsRequest): Promise<void> =>
      sender.sendProtocolRequest(chatDoc === null ? { Documents: request } : { ChatDocuments: { chat_doc: chatDoc, request } }),
    onResponse: (listener: (response: DocumentsEvent['answer']) => void): (() => void) =>
      eventEmitter.on(DOCUMENTS_EVENT, (event: DocumentsEvent | undefined): void => { if (event && event.chatDoc === chatDoc) listener(event.answer); }),
    onError: (listener: (message: string) => void): (() => void) => chatDoc !== null ? (): void => undefined :
      eventEmitter.on('workspace:raw-response', (response: unknown): void => {
        const message: unknown = typeof response === 'object' && response !== null && 'Error' in response ? (response as { Error: unknown }).Error : undefined;
        if (typeof message === 'string') listener(message);
      }),
    // What the tab shows (ServerReconnectWatcher sets it for this tab's own session): a page
    // opened while the agent re-dials starts with the link down.
    link: (): LinkState => (reconnectingTo.get() === null ? 'up' : 'down'),
    onLink: (listener: (state: LinkState) => void): (() => void) =>
      eventEmitter.on('websocket-message', (message: unknown): void => {
        const event: AgentReconnectEvent | null = readAgentReconnectEvent(message);
        if (event === null || event.cid !== selfCid) return;
        if (event.kind === 'reconnected') listener('up');
        else listener('down');
      }),
  };
}
