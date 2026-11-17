/**
 * Applying what the agent says changed in this account's conversations.
 *
 * When the agent hosts the account it is the only writer (agent 0.8.6): every
 * message in, every send, edit, reaction, read, clear and expiry is stored by
 * it and then announced to every window attached to the session as a
 * `ConversationEvent`. The window that asked and the windows that did not take
 * the same path here, so two windows never disagree about a transcript. Nothing
 * here writes the store; the agent already has.
 *
 * `seq` rises by one per event for the account. A gap (an event this window
 * never saw) or a restart of the count means the window's copy can be stale,
 * so it re-reads rather than patching on top of what it may have missed.
 */
import type { ConversationEvent } from 'citadel-internal-service-wasm-client';
import type { P2PConversation, P2PMessage } from '../p2p/p2p-types';
import { replaceHeld, dropHeld } from '../p2p/conversation-memory';
import { MESSAGES_EXPIRED_EVENT, type MessagesExpired } from '../p2p/retention';

export interface ConversationEventDeps {
  ownCid: () => Promise<bigint | null>;
  getOrCreateConversation: (peerCid: bigint, peerUsername?: string) => P2PConversation;
  holdInMemory: (peerCid: bigint, message: P2PMessage) => Promise<boolean>;
  clearMessages: (peerCid: bigint) => void;
  notifyMessage: (message: P2PMessage) => void;
  notifyStatus: (messageId: string, status: P2PMessage['status']) => void;
  /** The in-app toast for a message that arrived while the user looked elsewhere. */
  notifyArrived: (peerCid: bigint, message: P2PMessage) => void;
  emit: (event: string, data?: unknown) => void;
  /** Re-read the account's conversations: this window may have missed events. */
  resync: () => Promise<void>;
}

/** The event inside an inbound message, if it is one. */
export function conversationEventOf(message: unknown): ConversationEvent | null {
  const m: Record<string, unknown> = (message ?? {}) as Record<string, unknown>;
  const inner: unknown = (m.Response as Record<string, unknown> | undefined)?.ConversationEvent ?? m.ConversationEvent;
  return typeof inner === 'object' && inner !== null ? (inner as ConversationEvent) : null;
}

export function createConversationEventApplier(deps: ConversationEventDeps): (event: ConversationEvent) => Promise<void> {
  const lastSeq: Map<bigint, bigint> = new Map();

  function inSequence(event: ConversationEvent): boolean {
    const previous: bigint | undefined = lastSeq.get(event.cid);
    lastSeq.set(event.cid, event.seq);
    return previous === undefined || event.seq === previous + 1n;
  }

  return async (event: ConversationEvent): Promise<void> => {
    // One socket carries every account in this browser; the router hands this
    // tab only its own, and this holds to it if that ever changes.
    if (event.cid !== (await deps.ownCid())) return;
    const fresh: boolean = inSequence(event);

    const peer: bigint = event.peer_cid;
    const conversation: P2PConversation = deps.getOrCreateConversation(peer, event.peer_username ?? undefined);
    const message: P2PMessage | null = event.message ?? null;

    switch (event.kind) {
      case 'Appended':
        if (message && (await deps.holdInMemory(peer, message))) {
          deps.notifyMessage(message);
          if (message.senderCid === event.cid) {
            deps.emit('p2p:message-sent', { peerCid: peer, message });
          } else {
            deps.emit('p2p:message-received', {
              peerCid: peer, messageId: message.id, text: message.content, timestamp: message.timestamp, message,
            });
            deps.notifyArrived(peer, message);
          }
        }
        break;
      case 'Updated':
        if (message) {
          replaceHeld(conversation, message);
          deps.notifyStatus(message.id, message.status);
          deps.emit('p2p:message-updated', message);
        }
        break;
      case 'Removed':
        if (event.message_id) {
          dropHeld(conversation, event.message_id);
          deps.emit('p2p:message-deleted', { peerCid: peer, messageId: event.message_id });
        }
        break;
      case 'Cleared':
        deps.clearMessages(peer);
        deps.emit('p2p:conversation-cleared', { peerCid: peer });
        break;
      case 'Expired': {
        // The agent's metadata after the sweep: the oldest message it kept is
        // the line, and with nothing kept every message the window holds is gone.
        const cutoff: number = event.metadata && event.metadata.totalMessageCount > 0
          ? event.metadata.oldestMessageTimestamp
          : Number.POSITIVE_INFINITY;
        conversation.messages = conversation.messages.filter((m) => m.timestamp >= cutoff);
        const expired: MessagesExpired = { peerCid: peer, cutoff };
        deps.emit(MESSAGES_EXPIRED_EVENT, expired);
        break;
      }
      case 'MetadataChanged':
        break;
    }

    // The agent's count is the count: it alone knows what every window read.
    if (event.metadata) {
      conversation.unreadCount = event.metadata.unreadCount;
      if (event.metadata.peerUsername) conversation.peerUsername = event.metadata.peerUsername;
    }
    deps.emit('p2p:conversation-updated', { peerCid: peer, conversation });

    if (!fresh) await deps.resync();
  };
}
