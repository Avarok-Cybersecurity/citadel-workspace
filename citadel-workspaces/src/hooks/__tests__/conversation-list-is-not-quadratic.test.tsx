/**
 * The conversation list is rebuilt on every received message. It must not pay per conversation.
 *
 * Two costs sat inside the per-conversation map: `isPeerConnected(peerCid)` — which awaits
 * `getCurrentCid()`, and that can reach IndexedDB behind a 500ms race — and a linear `.find`
 * over every registered peer for the username. With C conversations and P peers that is C
 * session lookups and O(C×P) comparisons, repeated on `p2p:message-received`,
 * `p2p:message-sent` and `p2p:conversation-updated`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const CONVERSATIONS: number = 25;
const PEERS: number = 200;
let currentCidCalls: number = 0;

const conversations: { peerCid: bigint; messages: { timestamp: number; }[]; unreadCount: number; }[] = Array.from({ length: CONVERSATIONS }, (_: unknown, i: number): { peerCid: bigint; messages: { timestamp: number; }[]; unreadCount: number; } => ({
  peerCid: BigInt(1000 + i),
  messages: [{ timestamp: i }],
  unreadCount: 0,
}));
const registeredPeers: { cid: string; username: string; isOnline: boolean; }[] = Array.from({ length: PEERS }, (_: unknown, i: number): { cid: string; username: string; isOnline: boolean; } => ({
  cid: String(1000 + i),
  username: `peer${i}`,
  isOnline: true,
}));

vi.mock('@/lib/p2p/current-cid', () => ({
  getCurrentCid: async (): Promise<bigint> => {
    currentCidCalls += 1;
    return 7n;
  },
}));
vi.mock('@/lib/p2p', () => ({
  P2PMessengerManager: { getInstance: (): { getAllConversations: () => { peerCid: bigint; messages: { timestamp: number; }[]; unreadCount: number; }[]; } => ({ getAllConversations: (): { peerCid: bigint; messages: { timestamp: number; }[]; unreadCount: number; }[] => conversations }) },
}));
vi.mock('@/lib/connection', () => ({
  connectionManager: { getConnectionInfo: (): { cid: bigint; } => ({ cid: 7n }) },
}));
vi.mock('@/lib/p2p-auto-connect-service', () => ({
  p2pAutoConnectService: {
    peerOnlineStatus: (): boolean => true,
    isPeerConnectedForSession: (): boolean => true,
    isPeerConnected: async (): Promise<boolean> => {
      throw new Error('the per-conversation async path is back');
    },
    // Read through connectionPathFor, synchronously, for the session resolved once per load.
    getPeerConnectionInfo: (): null => null,
  },
}));
vi.mock('@/lib/debug-config', () => ({ debugEnabled: false, debugLog: (): void => {} }));

import { useConversationPeers } from '../use-conversation-peers';
import type { ConversationPeer } from '@/hooks/use-conversation-peers';

describe('the conversation list is not quadratic', () => {
  beforeEach(() => {
    currentCidCalls = 0;
  });

  it('resolves the session once per load, not once per conversation', async () => {
    const { result } = renderHook(() => useConversationPeers({ registeredPeers } as never));
    await waitFor(() => expect(result.current.peersWithConversations.length).toBe(CONVERSATIONS));
    expect(
      currentCidCalls,
      `getCurrentCid ran ${currentCidCalls} times for ${CONVERSATIONS} conversations`,
    ).toBeLessThanOrEqual(2);
  });

  it('names every peer correctly through the index', async () => {
    const { result } = renderHook(() => useConversationPeers({ registeredPeers } as never));
    await waitFor(() => expect(result.current.peersWithConversations.length).toBe(CONVERSATIONS));
    const names: string[] = result.current.peersWithConversations.map((p: ConversationPeer): string => p.peerUsername);
    expect(names).toContain('peer0');
    expect(new Set(names).size, 'every conversation resolved to a distinct peer').toBe(CONVERSATIONS);
  });
});
