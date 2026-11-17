/**
 * The sidebar lists your conversations once their history has loaded.
 *
 * Found live (2026-09-29): with a long DM history on screen, the sidebar's
 * CONVERSATIONS section said "No conversations yet". The messenger loads cached
 * history at start-up and announces it with `p2p:messages-loaded`; this hook
 * read the (still empty) list once, before that, and refreshed only on a sent or
 * received message -- so after a reload the list stayed empty until someone
 * wrote.
 *
 * Real: the hook and the global event bus. Stood in, as in
 * conversation-list-is-not-quadratic: the messenger (IndexedDB-backed), the
 * session and presence services (agent I/O).
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { eventEmitter } from '@/lib/event-emitter';

interface Conversation { peerCid: bigint; messages: { timestamp: number }[]; unreadCount: number }
const inMemory: Conversation[] = [];

vi.mock('@/lib/p2p/current-cid', () => ({ getCurrentCid: async (): Promise<bigint> => 7n }));
vi.mock('@/lib/p2p', () => ({
  P2PMessengerManager: { getInstance: (): { getAllConversations: () => Conversation[] } => ({ getAllConversations: (): Conversation[] => [...inMemory] }) },
}));
vi.mock('@/lib/connection', () => ({ connectionManager: { getConnectionInfo: (): { cid: bigint } => ({ cid: 7n }) } }));
vi.mock('@/lib/p2p-auto-connect-service', () => ({
  p2pAutoConnectService: {
    peerOnlineStatus: (): boolean => false,
    isPeerConnectedForSession: (): boolean => false,
    getPeerConnectionInfo: (): null => null,
  },
}));

import { useConversationPeers } from '../use-conversation-peers';

describe('the sidebar conversation list after a reload', () => {
  it('fills in when the cached history finishes loading', async () => {
    const registeredPeers: { cid: string; username: string; isOnline: boolean }[] = [{ cid: '8971774964460040856', username: 'tbraun96', isOnline: false }];
    const { result } = renderHook(() => useConversationPeers({ registeredPeers } as never));
    await waitFor(() => expect(result.current.peersWithConversations).toEqual([]));

    inMemory.push({ peerCid: 8971774964460040856n, messages: [{ timestamp: 1 }], unreadCount: 0 });
    act((): void => { eventEmitter.emit('p2p:messages-loaded'); });

    await waitFor(() => expect(result.current.peersWithConversations.map((c) => c.peerUsername)).toEqual(['tbraun96']));
  });
});
