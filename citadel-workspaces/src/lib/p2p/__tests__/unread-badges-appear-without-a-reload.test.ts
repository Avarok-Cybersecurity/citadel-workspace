/**
 * The P2P sidebar's unread badge never appeared while the app was running.
 *
 * Two counters exist: the persisted one on the page metadata, and the in-memory
 * one on the conversation. Every badge in the app reads the in-memory one --
 * use-conversation-peers, P2PPeerList, MembersSection -- and nothing ever
 * incremented it. The only writers were resets and decrements. So a message
 * arriving in a conversation the user did not have open produced no badge at
 * all, until the next reload copied the persisted count in from storage.
 *
 * The persisted side has incremented since it was written. This is the other
 * half, and it is the half the user can see.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../message-pagination-store', () => ({
  messagePaginationStore: { appendMessageToPage: vi.fn().mockResolvedValue(undefined) },
}));

import { ConversationManager } from '../conversation-manager';
import type { P2PMessage } from '../p2p-types';

const ME: bigint = 1n;
const PEER: bigint = 2n;

function manager(): ConversationManager {
  return new ConversationManager({
    getCurrentCid: async () => ME,
    maxMessagesPerConversation: 100,
    maxQueueSize: 100,
  });
}

let counter: number = 0;
function message(overrides: Partial<P2PMessage> = {}): P2PMessage {
  counter += 1;
  return {
    id: `m${counter}`,
    content: 'hello',
    senderCid: PEER,
    recipientCid: ME,
    timestamp: counter,
    index: counter,
    status: 'delivered',
    ...overrides,
  } as P2PMessage;
}

describe('the in-memory unread count', () => {
  beforeEach(() => { counter = 0; });

  it('rises when a delivered message arrives from the peer', async () => {
    const m: ConversationManager = manager();

    await m.addMessageToConversation(PEER, message());
    await m.addMessageToConversation(PEER, message());

    expect(m.getConversationsMap().get(PEER)?.unreadCount).toBe(2);
  });

  it('does not count the user\'s own messages', async () => {
    const m: ConversationManager = manager();

    await m.addMessageToConversation(PEER, message({ senderCid: ME, recipientCid: PEER }));

    expect(m.getConversationsMap().get(PEER)?.unreadCount).toBe(0);
  });

  it('does not count a message that has not been delivered yet', async () => {
    // A pending inbound message is not yet news; the persisted side applies the
    // same predicate, and the two must not disagree or the badge would change
    // across a reload.
    const m: ConversationManager = manager();

    await m.addMessageToConversation(PEER, message({ status: 'pending' }));

    expect(m.getConversationsMap().get(PEER)?.unreadCount).toBe(0);
  });

  it('does not double-count a redelivered message', async () => {
    const m: ConversationManager = manager();
    const redelivered: P2PMessage = message();

    await m.addMessageToConversation(PEER, redelivered);
    await m.addMessageToConversation(PEER, redelivered);

    expect(m.getConversationsMap().get(PEER)?.unreadCount).toBe(1);
  });
});
