/**
 * The conversation list in the sidebar refreshes on p2p:message-received,
 * p2p:message-sent and p2p:conversation-updated (use-conversation-peers.ts).
 *
 * Two of those three had a subscriber and no emitter, so the list only ever
 * updated on receive. These tests pin the event NAMES, which is where both bugs
 * were: one event was never emitted at all, the other was emitted without the
 * 'p2p:' prefix the subscriber listens for.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { greetAs } from '@/lib/agent-conversations/__tests__/agent-greeting';
import { markMessagesAsRead } from '../messenger-compatibility';
import type { P2PConversation, P2PMessage } from '../p2p-types';

function message(id: string, senderCid: bigint, status: P2PMessage['status']): P2PMessage {
  return {
    id, senderCid, recipientCid: 1n, content: 'hi', timestamp: Date.now(), index: 0, status,
  } as P2PMessage;
}


// The browser-written store is the path for an agent before 0.8.6; this tab's socket greeted one.
beforeAll(() => greetAs('older'));
describe('markMessagesAsRead', () => {
  const peerCid: bigint = 42n;

  function setup(messages: P2PMessage[]): { conversation: P2PConversation; conversationManager: { getConversation: ReturnType<typeof vi.fn>; }; emit: ReturnType<typeof vi.fn>; sendAck: ReturnType<typeof vi.fn>; } {
    const conversation: P2PConversation = { peerCid, messages, unreadCount: messages.length } as unknown as P2PConversation;
    const conversationManager: { getConversation: ReturnType<typeof vi.fn> } = { getConversation: vi.fn((): P2PConversation => conversation) };
    const emit: ReturnType<typeof vi.fn> = vi.fn();
    const sendAck: ReturnType<typeof vi.fn> = vi.fn((): Promise<void> => Promise.resolve());
    return { conversation, conversationManager, emit, sendAck };
  }

  it("emits the prefixed 'p2p:conversation-updated' the sidebar subscribes to", async () => {
    const s: ReturnType<typeof setup> = setup([message('m1', peerCid, 'delivered')]);

    await markMessagesAsRead(
      s.conversationManager as never, s.sendAck, s.emit, peerCid
    );

    const names: ReturnType<typeof s.emit.mock.calls.map> = s.emit.mock.calls.map(c => c[0]);
    expect(names).toContain('p2p:conversation-updated');
    // The unprefixed name had no subscriber anywhere - guard against it coming back.
    expect(names).not.toContain('conversation-updated');
  });

  it('clears the unread count it reports', async () => {
    const s: ReturnType<typeof setup> = setup([message('m1', peerCid, 'delivered')]);

    await markMessagesAsRead(
      s.conversationManager as never, s.sendAck, s.emit, peerCid
    );

    expect(s.conversation.unreadCount).toBe(0);
    const payload: unknown = s.emit.mock.calls.find(c => c[0] === 'p2p:conversation-updated')?.[1];
    expect(payload).toMatchObject({ peerCid });
  });

  it('does nothing when there is no conversation', async () => {
    const conversationManager: { getConversation: ReturnType<typeof vi.fn> } = { getConversation: vi.fn((): undefined => undefined) };
    const emit: ReturnType<typeof vi.fn> = vi.fn();

    await markMessagesAsRead(
      conversationManager as never, vi.fn(() => Promise.resolve()), emit, peerCid
    );

    expect(emit).not.toHaveBeenCalled();
  });
});
