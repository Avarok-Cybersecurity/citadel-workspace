/**
 * An edit, a deletion or a clear that changes nothing in this view keeps the transcript's array.
 *
 * `status` already returned the same array for a message the view does not hold; `updated`,
 * `removed` and `cleared` allocated a new one regardless. The chat's scroll-follow effect keys on
 * that array, so each of them ran it for nothing (see sending-past-a-pending-update-does-not-loop),
 * and a channel's receipts can name messages before the page holding them has rendered.
 *
 * Drives the real `subscribeToConversationEvents` and applies the updaters it hands to
 * setMessages. The transport double carries only a history port whose listener the test calls:
 * the subscription reads nothing else from a transport without status.
 */
import { describe, it, expect } from 'vitest';
import { subscribeToConversationEvents } from '../useP2PMessages-subscriptions';
import type { ChatMessage, ChatTransport, HistoryEvent } from '@/lib/chat/transport/chat-transport';

type Updater = (prev: ChatMessage[]) => ChatMessage[];

const HELD: ChatMessage[] = [{ id: 'a', content: 'one' }, { id: 'b', content: 'two' }] as unknown as ChatMessage[];
const EMPTY: ChatMessage[] = [];

function listen(): { hear: (event: HistoryEvent) => void; updates: Updater[] } {
  let heard: ((event: HistoryEvent) => void) | null = null;
  const updates: Updater[] = [];
  const transport: ChatTransport = {
    history: { subscribe: (listener: (event: HistoryEvent) => void): (() => void) => { heard = listener; return (): void => undefined; } },
    status: null,
  } as unknown as ChatTransport;
  subscribeToConversationEvents({
    transport,
    activeTabIdRef: { current: 'messages' },
    pinnedRef: { current: true },
    onUnreadMessage: (): void => undefined,
    setMessages: ((next: Updater | ChatMessage[]): void => { updates.push(typeof next === 'function' ? next : (): ChatMessage[] => next); }) as never,
    setTyping: ((): void => undefined) as never,
    setIsConnected: ((): void => undefined) as never,
    setPeerPresence: ((): void => undefined) as never,
    setIsRegistered: ((): void => undefined) as never,
  });
  return { hear: (event: HistoryEvent): void => { if (heard === null) throw new Error('nothing subscribed'); heard(event); }, updates };
}

describe('a history event about nothing this view holds', () => {
  it('keeps the array for an update to a message not held', () => {
    const { hear, updates } = listen();
    hear({ kind: 'updated', message: { id: 'elsewhere', content: 'edited' } });
    expect(updates[0]!(HELD)).toBe(HELD);
  });

  it('keeps the array for the removal of a message not held', () => {
    const { hear, updates } = listen();
    hear({ kind: 'removed', messageId: 'elsewhere' });
    expect(updates[0]!(HELD)).toBe(HELD);
  });

  it('keeps an empty transcript when it is cleared', () => {
    const { hear, updates } = listen();
    hear({ kind: 'cleared' });
    expect(updates[0]!(EMPTY)).toBe(EMPTY);
  });
});

describe('a history event about a message this view holds', () => {
  it('applies an update', () => {
    const { hear, updates } = listen();
    hear({ kind: 'updated', message: { id: 'b', content: 'edited' } });
    expect(updates[0]!(HELD).map((m: ChatMessage): string => m.content)).toEqual(['one', 'edited']);
  });

  it('removes the message', () => {
    const { hear, updates } = listen();
    hear({ kind: 'removed', messageId: 'a' });
    expect(updates[0]!(HELD).map((m: ChatMessage): string => m.id)).toEqual(['b']);
  });

  it('clears a transcript that has messages', () => {
    const { hear, updates } = listen();
    hear({ kind: 'cleared' });
    expect(updates[0]!(HELD)).toEqual([]);
  });
});
