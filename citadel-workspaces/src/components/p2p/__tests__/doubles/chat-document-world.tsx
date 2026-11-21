/**
 * Two people's chats in one page, each the whole P2PChat, unmodified, with its documents on
 * the real Citadel Docs engine (the vendored wasm, in process: jsdom has no Worker). Only
 * what is outside the browser is a stand-in:
 *
 *  - the network: the agent's P2P send (`sendP2PMessageBytes`) hands the production CBOR to the
 *    other person's page as the message handler does (`cdoc:chat-command`), and the messenger's
 *    `sendMessage` records the invitation's bubble and then hangs, fails, or fails first;
 *  - the agent's LocalDB (`sendLocalDBGet`/`sendLocalDBSet`), one keyspace per session, as the
 *    agent keeps them (FakeAgentLocalDb);
 *  - the conversation store: what the recipient's conversation holds when it opens.
 *
 * The test file declares the runtime-loader mock (vi.mock is per file); see useInProcessCdoc.
 */
import { vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { websocketService } from '@/lib/websocket-service';
import { eventEmitter } from '@/lib/event-emitter';
import { P2PMessengerManager } from '@/lib/p2p';
import type { P2PMessage, P2PConversation } from '@/lib/p2p/p2p-types';
import type { SendMessageOptions } from '@/lib/p2p/message-sender-types';
import { deserializeP2PCommand, P2PCommandType, type P2PCommand } from '@/types/p2p-commands';
import { CDOC_CHAT_COMMAND_EVENT, isCdocChatSyncPayload, type CdocChatCommandEvent } from '@/types/cdoc-chat-sync';
import { registerCapabilityRoute } from '@/lib/agent-conversations/capabilities';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ConfirmDialogProvider } from '@/components/shared/confirm-dialog';
import { Toaster } from '@/components/ui/sonner';
import { FakeAgentLocalDb } from '@/lib/cdoc/chat/__tests__/doubles/fake-agent-local-db';
import type { LocalDbPort } from '@/lib/cdoc/chat/chat-local-db';
import { P2PChat } from '../../P2PChat';

export const ALICE: bigint = 10_000_000_000_000_000_101n;
export const BOB: bigint = 10_000_000_000_000_000_202n;
export const NAMES: ReadonlyMap<bigint, string> = new Map<bigint, string>([[ALICE, 'Alice'], [BOB, 'Bob']]);

type Send = (peer: bigint, content: string, options?: SendMessageOptions) => Promise<P2PMessage>;
export type Delivery = 'in-flight' | 'fails' | 'fails-before-recording';

export interface Invitation {
  readonly from: bigint;
  readonly to: bigint;
  readonly content: string;
  readonly options: SendMessageOptions;
}

export class ChatDocumentWorld {
  readonly db: FakeAgentLocalDb = new FakeAgentLocalDb();
  readonly invitations: Invitation[] = [];
  /** Every chat-document command the network carried, by kind, in order. */
  readonly carried: string[] = [];
  /** What each person's conversation holds when it opens, by the account it belongs to. */
  private readonly inbox: Map<bigint, P2PMessage[]> = new Map<bigint, P2PMessage[]>();
  delivery: Delivery = 'in-flight';
  private readonly connection: LocalDbPort = this.db.connection([0n, ALICE, BOB]);

  install(): void {
    // The leader's answer to "what does the agent host": nothing, so this browser runs its own messaging.
    registerCapabilityRoute({
      isLeader: (): boolean => false,
      askLeader: async () => ({ supervisesP2p: false, stagesUploads: false, nativePicker: false, takesConsole: false, noticesHeard: false, servesApps: false }),
    });
    vi.spyOn(websocketService, 'sendLocalDBGet').mockImplementation(async (cid: bigint, key: string): Promise<{ value: number[] } | null> => {
      const found: { readonly value: readonly number[] } | null = await this.connection.get(cid, key);
      return found === null ? null : { value: [...found.value] };
    });
    vi.spyOn(websocketService, 'sendLocalDBSet').mockImplementation((cid: bigint, key: string, value: number[]): Promise<void> => this.connection.set(cid, key, value));
    vi.spyOn(websocketService, 'sendP2PMessageBytes').mockImplementation(async (from: bigint, to: bigint, bytes: Uint8Array): Promise<void> => {
      const command: P2PCommand = deserializeP2PCommand(bytes.slice());
      if (command.type !== P2PCommandType.CdocChatSync || !isCdocChatSyncPayload(command.payload)) return;
      const event: CdocChatCommandEvent = { peerCid: from, recipient_cid: to, payload: command.payload };
      this.carried.push(command.payload.sync.kind);
      // Asynchronous, as the network is: the sender's step finishes before the peer hears it.
      setTimeout((): void => { eventEmitter.emit(CDOC_CHAT_COMMAND_EVENT, event); }, 0);
    });
    const messenger: P2PMessengerManager = P2PMessengerManager.getInstance();
    vi.spyOn(messenger, 'getConversationMetadata').mockResolvedValue(null);
    vi.spyOn(messenger, 'getConversation').mockImplementation((peer: bigint): P2PConversation | undefined => {
      const messages: P2PMessage[] | undefined = this.inbox.get(peer);
      return messages === undefined ? undefined : { peerCid: peer, messages, lastMessageIndex: messages.length, unreadCount: 0, typing: false, lastTypingUpdate: 0, presence: null };
    });
    vi.spyOn(messenger, 'sendMessage').mockImplementation(this.send);
  }

  /** The conversation `holder` has with `from` holds `message` when it opens (keyed by the peer, as the store is). */
  received(from: bigint, message: P2PMessage): void {
    this.inbox.set(from, [...(this.inbox.get(from) ?? []), message]);
  }

  /** An invitation `from` sent before this release: a bare UUID, the earlier editor's document. */
  earlierInvitation(from: bigint, to: bigint, docId: string, title: string): P2PMessage {
    return {
      id: `earlier-${docId}`, content: `Created live document: ${title}`, sender_cid: from, recipient_cid: to, timestamp: 1_600_000_000_000, index: 0,
      status: 'delivered', message_type: 'live_document', document_id: docId, document_title: title,
    };
  }

  /** The invitation `from` sent, as the peer's conversation stores it. */
  invitationAsReceived(index: number): P2PMessage {
    const sent: Invitation = this.invitations[index];
    return {
      id: `invitation-${index}`, content: sent.content, sender_cid: sent.from, recipient_cid: sent.to, timestamp: 1_700_000_000_000 + index, index,
      status: 'delivered', message_type: 'live_document', document_id: sent.options.documentId, document_title: sent.options.documentTitle,
    };
  }

  private readonly send: Send = async (peer: bigint, content: string, options?: SendMessageOptions): Promise<P2PMessage> => {
    if (this.delivery === 'fails-before-recording') throw new Error('Not connected to server');
    const from: bigint = peer === ALICE ? BOB : ALICE;
    this.invitations.push({ from, to: peer, content, options: options ?? {} });
    options?.onOptimisticAppend?.();
    if (this.delivery === 'fails') throw new Error(`Peer ${peer.toString()} did not acknowledge the message`);
    return new Promise<P2PMessage>((): void => undefined);
  };
}

/** `self`'s chat with `peer`, as the messages page mounts it. */
export function chatOf(self: bigint, peer: bigint): JSX.Element {
  return (
    <div data-testid={`chat-of-${NAMES.get(self) ?? ''}`}>
      <P2PChat peerCid={peer} peerName={NAMES.get(peer)} peerUsername={NAMES.get(peer)?.toLowerCase()} currentUserCid={self} currentUserName={NAMES.get(self)} />
    </div>
  );
}

export function renderChats(...chats: readonly JSX.Element[]): void {
  render(
    <MemoryRouter initialEntries={['/workspace']}>
      <ConfirmDialogProvider><TooltipProvider>
        {chats}
        <Toaster />
      </TooltipProvider></ConfirmDialogProvider>
    </MemoryRouter>,
  );
}
