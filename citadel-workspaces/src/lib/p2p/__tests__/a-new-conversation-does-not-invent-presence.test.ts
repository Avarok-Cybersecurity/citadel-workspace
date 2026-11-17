/**
 * A conversation created for a peer nobody has heard from is not Online.
 *
 * `getOrCreateConversation` is synchronous, and it used to put an ASYNC call
 * in the middle of its `||` chain:
 *
 *   const isOnline = isConnectedLocal || isPeerConnected(cid) || isPeerOnline(cid);
 *
 * `isPeerConnected` returns a Promise, and a pending Promise is truthy. So
 * `isOnline` was true whenever the local map said false -- which is every peer
 * at the moment its conversation is created. Every new conversation opened as
 * Online, with `lastUpdate: Date.now()` to make it look freshly observed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { P2PConversation } from '../p2p-types';

const reg: { answer: boolean | null } = vi.hoisted((): { answer: boolean | null } => ({ answer: null }));

vi.mock('@/lib/p2p-auto-connect-service', () => ({
  p2pAutoConnectService: {
    // Async, as the real one is. Its promise is what used to be read as "yes".
    isPeerConnected: (): Promise<boolean | null> => Promise.resolve(null),
    peerOnlineStatus: (): boolean | null => reg.answer,
  },
}));

// Held across each test's vi.resetModules() as the real modules: the
// registration service, the socket service and the connection layer are ~160 of
// the ~240 modules ConversationManager re-imports, none of them decides a new
// conversation's presence (the auto-connect service above does), and every
// reset module is a round trip to the vitest main process -- seconds on a loaded
// runner. See an-edit-or-delete-survives-a-reload.
vi.mock('@/lib/p2p-registration-service', async (importOriginal) => importOriginal());
vi.mock('@/lib/websocket-service', async (importOriginal) => importOriginal());
vi.mock('@/lib/connection', async (importOriginal) => importOriginal());

// Transformed at collection, which no test timeout measures, not in the first test.
import '../conversation-manager';

describe('a conversation created for an unheard-of peer', () => {
  beforeEach(() => { vi.resetModules(); reg.answer = null; });

  it('is unknown, not Online and not Offline', async () => {
    const { ConversationManager } = await import('../conversation-manager');

    const manager: InstanceType<typeof ConversationManager> = new ConversationManager({
      getCurrentCid: (): Promise<bigint | null> => Promise.resolve(1n),
      maxMessagesPerConversation: 100,
      maxQueueSize: 100,
    });
    const conv: P2PConversation = manager.getOrCreateConversation(999n, 'nobody');

    expect(conv.presence).toBeNull();
  });

  it('is Offline when the registry says offline, and not seen just now', async () => {
    reg.answer = false;
    const { ConversationManager } = await import('../conversation-manager');
    const { MessagingLayerType } = await import('@/types/p2p-commands');
    const manager: InstanceType<typeof ConversationManager> = new ConversationManager({
      getCurrentCid: (): Promise<bigint | null> => Promise.resolve(1n),
      maxMessagesPerConversation: 100,
      maxQueueSize: 100,
    });
    const conv: P2PConversation = manager.getOrCreateConversation(999n, 'nobody');
    expect(conv.presence?.status).toBe(MessagingLayerType.Offline);
    expect(conv.presence?.lastUpdate).toBe(0);
  });

  it('is Online when a synchronous source actually says so', async () => {
    // Positive control: the fix must not simply make everyone offline. The
    // local connection map is the first thing the chain reads, and it still
    // counts.
    const { ConversationManager } = await import('../conversation-manager');
    const { MessagingLayerType } = await import('@/types/p2p-commands');

    const manager: InstanceType<typeof ConversationManager> = new ConversationManager({
      getCurrentCid: (): Promise<bigint | null> => Promise.resolve(1n),
      maxMessagesPerConversation: 100,
      maxQueueSize: 100,
    });
    manager.setConnection(999n, true);
    const conv: P2PConversation = manager.getOrCreateConversation(999n, 'somebody');

    expect(conv.presence?.status).toBe(MessagingLayerType.Online);
    expect(conv.presence?.lastUpdate).toBeGreaterThan(0);
  });
});
