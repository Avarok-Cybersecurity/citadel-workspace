/**
 * Every window applies the agent's ConversationEvents the same way, whether it
 * asked for the change or not: that is what keeps two windows' transcripts
 * identical without either writing the store.
 *
 * The in-memory window is the real ConversationManager; what it tells the rest
 * of the app (listeners, events, the toast) is recorded rather than rendered.
 */
import { describe, it, expect } from 'vitest';
import type { ConversationEvent, ConversationEventKind, ConversationMetadata } from 'citadel-internal-service-wasm-client';
import { createConversationEventApplier, conversationEventOf, type ConversationEventDeps } from '../conversation-events';
import { ConversationManager } from '../../p2p/conversation-manager';
import type { P2PMessage } from '../../p2p/p2p-types';

const ME: bigint = 11n;
const BOB: bigint = 22n;

function message(id: string, from: bigint, extra: Partial<P2PMessage> = {}): P2PMessage {
  return {
    id, content: `text of ${id}`, senderCid: from, recipientCid: from === ME ? BOB : ME,
    timestamp: 1000, index: 1, status: 'delivered', message_type: 'text', ...extra,
  };
}

function metadata(extra: Partial<ConversationMetadata> = {}): ConversationMetadata {
  return {
    peerCid: BOB, totalMessageCount: 1, oldestMessageTimestamp: 1000, newestMessageTimestamp: 1000,
    latestPage: 0, messagesPerPage: 50, unreadCount: 0, lastMessageIndex: 1, lastUpdated: 0, ...extra,
  };
}

let seq: bigint = 0n;
function event(kind: ConversationEventKind, extra: Partial<ConversationEvent> = {}): ConversationEvent {
  seq += 1n;
  return {
    cid: ME, peer_cid: BOB, seq, kind, message: null, message_id: null, metadata: null,
    account_username: 'me', peer_username: 'bob', preview: '', request_id: null, ...extra,
  };
}

interface World {
  apply: (e: ConversationEvent) => Promise<void>;
  conversations: ConversationManager;
  emitted: Array<[string, unknown]>;
  heard: string[];
  statuses: Array<[string, string]>;
  toasts: string[];
  resyncs: number;
}

function world(): World {
  const conversations: ConversationManager = new ConversationManager({ getCurrentCid: async () => ME, maxMessagesPerConversation: 100, maxQueueSize: 100 });
  const w: World = { apply: async () => {}, conversations, emitted: [], heard: [], statuses: [], toasts: [], resyncs: 0 };
  const deps: ConversationEventDeps = {
    ownCid: async () => ME,
    getOrCreateConversation: (p, u) => conversations.getOrCreateConversation(p, u),
    holdInMemory: (p, m) => conversations.holdInMemory(p, m),
    clearMessages: (p) => conversations.clearMessages(p),
    notifyMessage: (m) => { w.heard.push(m.id); },
    notifyStatus: (id, status) => { w.statuses.push([id, status]); },
    notifyArrived: (_p, m) => { w.toasts.push(m.id); },
    emit: (name, data) => { w.emitted.push([name, data]); },
    resync: async () => { w.resyncs += 1; },
  };
  w.apply = createConversationEventApplier(deps);
  return w;
}

const held = (w: World): string[] => (w.conversations.getConversation(BOB)?.messages ?? []).map((m) => m.id);
const names = (w: World): string[] => w.emitted.map(([n]) => n);

describe('applying the agent\'s conversation events', () => {
  it('shows an arriving message, tells its listeners, and takes the agent\'s unread count', async () => {
    const w: World = world();
    await w.apply(event('Appended', { message: message('m1', BOB), metadata: metadata({ unreadCount: 4 }) }));
    expect(held(w)).toEqual(['m1']);
    expect(w.heard).toEqual(['m1']);
    expect(w.toasts).toEqual(['m1']);
    expect(names(w)).toEqual(['p2p:message-received', 'p2p:conversation-updated']);
    expect(w.conversations.getConversation(BOB)?.unreadCount).toBe(4);
  });

  it('shows our own message from another window as sent, without a toast', async () => {
    const w: World = world();
    await w.apply(event('Appended', { message: message('m2', ME, { status: 'pending' }) }));
    expect(held(w)).toEqual(['m2']);
    expect(w.toasts).toEqual([]);
    expect(names(w)).toEqual(['p2p:message-sent', 'p2p:conversation-updated']);
  });

  it('does not show the same message twice', async () => {
    const w: World = world();
    await w.apply(event('Appended', { message: message('m1', BOB) }));
    await w.apply(event('Appended', { message: message('m1', BOB) }));
    expect(w.heard).toEqual(['m1']);
  });

  it('replaces an updated message and reports its status', async () => {
    const w: World = world();
    await w.apply(event('Appended', { message: message('m3', ME, { status: 'pending' }) }));
    await w.apply(event('Updated', { message: message('m3', ME, { status: 'sent' }) }));
    expect(w.conversations.getConversation(BOB)?.messages[0].status).toBe('sent');
    expect(w.statuses).toEqual([['m3', 'sent']]);
  });

  it('drops a removed message and a cleared conversation', async () => {
    const w: World = world();
    await w.apply(event('Appended', { message: message('a', BOB) }));
    await w.apply(event('Appended', { message: message('b', BOB) }));
    await w.apply(event('Removed', { message_id: 'a' }));
    expect(held(w)).toEqual(['b']);
    await w.apply(event('Cleared'));
    expect(held(w)).toEqual([]);
    expect(names(w)).toContain('p2p:message-deleted');
    expect(names(w)).toContain('p2p:conversation-cleared');
  });

  it('expires what is older than the oldest message the agent kept', async () => {
    const w: World = world();
    await w.apply(event('Appended', { message: message('old', BOB, { timestamp: 10 }) }));
    await w.apply(event('Appended', { message: message('new', BOB, { timestamp: 50 }) }));
    await w.apply(event('Expired', { metadata: metadata({ oldestMessageTimestamp: 50 }) }));
    expect(held(w)).toEqual(['new']);
    expect(w.emitted).toContainEqual(['p2p:messages-expired', { peerCid: BOB, cutoff: 50 }]);
  });

  it('ignores another account\'s events', async () => {
    const w: World = world();
    await w.apply(event('Appended', { cid: 99n, message: message('x', BOB) }));
    expect(held(w)).toEqual([]);
    expect(w.emitted).toEqual([]);
  });

  it('re-reads after a gap in the sequence, and only then', async () => {
    const w: World = world();
    await w.apply(event('MetadataChanged'));
    await w.apply(event('MetadataChanged'));
    expect(w.resyncs).toBe(0);
    seq += 3n;
    await w.apply(event('MetadataChanged'));
    expect(w.resyncs).toBe(1);
  });

  it('finds the event in a raw or a wrapped response', () => {
    const e: ConversationEvent = event('Cleared');
    expect(conversationEventOf({ ConversationEvent: e })).toBe(e);
    expect(conversationEventOf({ Response: { ConversationEvent: e } })).toBe(e);
    expect(conversationEventOf({ ConversationUpdated: {} })).toBeNull();
  });
});
