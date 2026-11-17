/**
 * A status transition for a message this conversation does not hold must not
 * change the array identity.
 *
 * `prev.map` always allocates a new array, so every sent/delivered/read
 * transition ANYWHERE in the messenger re-rendered every open conversation —
 * and because the chat's scroll effect keys on `messages`, it threw a reader
 * who had scrolled up back to the bottom. A delivery receipt in a completely
 * different chat moved your place in this one.
 *
 * Drives the real `subscribeToConversationEvents`, capturing the updater it
 * hands to setMessages. Testing a local copy of the guard would pass whatever
 * the product actually does.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/p2p-auto-connect-service', () => ({
  p2pAutoConnectService: { markChannelReady: (): void => {}, onPeerConnected: () => (): void => {} },
}));

const stub: { statusHandler: ((id: string, status: string) => void) | undefined } = vi.hoisted(() => ({ statusHandler: undefined }));
vi.mock('@/lib/p2p/p2p-messenger-manager', () => ({
  P2PMessengerManager: {
    getInstance: (): unknown => ({
      onMessage: () => (): void => {},
      onMessageStatusChange: (cb: (id: string, status: string) => void) => {
        stub.statusHandler = cb;
        return (): void => {};
      },
      onTyping: () => (): void => {},
      onConnectionChange: () => (): void => {},
      onPresenceChange: () => (): void => {},
    }),
  },
}));

import { subscribeToConversationEvents } from '../useP2PMessages-subscriptions';
import type { P2PMessage } from '@/lib/p2p';
import { peerTransportFor } from '@/components/p2p/__tests__/doubles/peer-transport';

const CONVERSATION: P2PMessage[] = [
  { id: 'a', status: 'sent' },
  { id: 'b', status: 'sent' },
] as unknown as P2PMessage[];

/** Wire up the real subscription over the real adapter and return the status-change callback. */
function captureStatusHandler(): { statusHandler: (id: string, status: string) => void; updates: ((prev: P2PMessage[]) => P2PMessage[])[]; } {
  stub.statusHandler = undefined;
  const updates: Array<(prev: P2PMessage[]) => P2PMessage[]> = [];

  subscribeToConversationEvents({
    transport: peerTransportFor({ cid: 42n, name: 'Bob' }, null),
    activeTabIdRef: { current: 'messages' },
    pinnedRef: { current: true },
    onUnreadMessage: () => {},
    setMessages: ((updater: (prev: P2PMessage[]) => P2PMessage[]) => {
      updates.push(updater);
    }) as never,
    setTyping: (() => {}) as never,
    setIsConnected: (() => {}) as never,
    setPeerPresence: (() => {}) as never,
    setIsRegistered: (() => {}) as never,
  });

  const statusHandler: ((id: string, status: string) => void) | undefined = stub.statusHandler;
  if (!statusHandler) throw new Error('the subscription did not register a status listener');
  return { statusHandler, updates };
}

describe('a status change', () => {
  it('returns the SAME array when the id is not in this conversation', () => {
    const { statusHandler, updates } = captureStatusHandler();

    statusHandler('from-another-chat', 'delivered');

    expect(updates).toHaveLength(1);
    // Identity, not deep equality: React re-renders on identity, and that
    // re-render is what moved the reader's scroll position.
    expect(updates[0]!(CONVERSATION)).toBe(CONVERSATION);
  });

  it('returns a new array when the id IS in this conversation', () => {
    const { statusHandler, updates } = captureStatusHandler();

    statusHandler('b', 'delivered');

    const next: P2PMessage[] = updates[0]!(CONVERSATION);
    expect(next).not.toBe(CONVERSATION);
    expect(next.find((m) => m.id === 'b')?.status).toBe('delivered');
    expect(next.find((m) => m.id === 'a')?.status).toBe('sent');
  });
});
