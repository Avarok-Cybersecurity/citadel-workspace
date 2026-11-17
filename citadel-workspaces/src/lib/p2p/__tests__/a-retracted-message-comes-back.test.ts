/**
 * Retracting a message removed it from the screen and not from storage, so it
 * returned on the next reload.
 *
 * `editMessage` and the inbound `MessageEdit` branch both persist through
 * `updateMessageInPages`. `deleteMessage` and the inbound `MessageDelete`
 * branch beside them mutate only the in-memory conversation and emit an event.
 * The paginated store had no per-message removal at all -- only
 * `deleteConversationPages`, which drops a whole conversation.
 *
 * `useP2PMessages` rebuilds the transcript from `loadLatestMessages`, i.e. from
 * those pages. So a retraction survived exactly as long as the component stayed
 * mounted: reopening the chat brought the message back, on both ends, with no
 * error anywhere. Worse than a visible failure -- the user was told the message
 * was withdrawn and it was not.
 *
 * These drive the real store with only the LocalDB transport mocked, and assert
 * on what a RELOAD would read, because that is where the defect showed.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { P2PMessage } from '../p2p-types';

vi.mock('@/lib/p2p-auto-connect-service', () => ({
  p2pAutoConnectService: {
    markChannelReady: (): void => {},
    isPeerConnected: async (): Promise<boolean> => true,
    ensurePeerConnectedInBackground: async (): Promise<undefined> => undefined,
  },
}));

const stored: Map<string, string> = new Map<string, string>();

vi.mock('../../websocket-service', () => ({
  websocketService: {
    sendLocalDBGet: async (_cid: bigint, key: string): Promise<{ value: string }> => {
      const value: string | undefined = stored.get(key);
      if (value === undefined) throw new Error(`no such key: ${key}`);
      return { value };
    },
    sendLocalDBSet: async (_cid: bigint, key: string, value: number[]): Promise<void> => {
      stored.set(key, String.fromCharCode(...value));
    },
    sendLocalDBDelete: async (_cid: bigint, key: string): Promise<void> => {
      stored.delete(key);
    },
  },
}));

// A fixed owner so the storage keys are deterministic. The real manager reads
// the live session; the key layout it produces is what is under test elsewhere.
vi.mock('@/lib/multi-instance/instance-manager', async (importOriginal: () => Promise<typeof import('@/lib/multi-instance/instance-manager')>) => {
  const { instanceManagerWith } = await import('@/test/instance-manager-double');
  const real: typeof import('@/lib/multi-instance/instance-manager') = await importOriginal();
  return { ...real, instanceManager: instanceManagerWith(real.instanceManager, { cid: 4242n }) };
});

const { messagePaginationStore } = await import('../message-pagination-store');
const { saveMetadata, saveMessagePage } = await import('../message-page-operations');

const PEER: bigint = 777n;
const OWNER: bigint = 4242n;

function message(id: string, content: string, senderCid: bigint = PEER): Record<string, unknown> {
  return {
    id, content, senderCid, recipientCid: senderCid === PEER ? OWNER : PEER,
    timestamp: 1_000, status: 'delivered', message_type: 'text',
  };
}

async function seedConversation(senderCid: bigint = PEER): Promise<void> {
  stored.clear();
  await saveMetadata(PEER, {
    peerCid: PEER, ownerCid: OWNER, peerUsername: 'peer',
    totalMessageCount: 2, oldestMessageTimestamp: 1_000, newestMessageTimestamp: 1_000,
    latestPage: 0, messagesPerPage: 50, unreadCount: 0, lastMessageIndex: 1,
    lastUpdated: 1_000,
  } as never);
  await saveMessagePage(PEER, 0, {
    peerCid: PEER, pageNumber: 0,
    messages: [message('keep-me', 'still here', senderCid), message('retract-me', 'oops', senderCid)],
  } as never);
}

describe('a retracted message must not come back', () => {
  beforeEach(async () => { await seedConversation(); });

  it('seeds two messages that a reload can see', async () => {
    // Positive control: without it, a removal test passes on an empty store.
    const onReload: P2PMessage[] = await messagePaginationStore.loadLatestMessages(PEER);
    expect(onReload.map((m) => m.id)).toEqual(['keep-me', 'retract-me']);
  });

  it('removes the retracted message from the page a reload reads', async () => {
    const removed: boolean = await messagePaginationStore.removeMessageFromPages(PEER, 'retract-me');
    expect(removed).toBe(true);

    const onReload: P2PMessage[] = await messagePaginationStore.loadLatestMessages(PEER);
    expect(onReload.map((m) => m.id)).toEqual(['keep-me']);
  });

  it('reports false for a message that is in no page, and disturbs nothing', async () => {
    const removed: boolean = await messagePaginationStore.removeMessageFromPages(PEER, 'never-existed');
    expect(removed).toBe(false);

    const onReload: P2PMessage[] = await messagePaginationStore.loadLatestMessages(PEER);
    expect(onReload.map((m) => m.id)).toEqual(['keep-me', 'retract-me']);
  });
});

/**
 * The wiring, not the helper.
 *
 * Twice this session a helper was covered and the line that calls it was not,
 * so deleting the call left every test green. These drive the real inbound
 * branch into the real store, and fail if the call is removed.
 */
describe('the inbound retraction reaches storage', () => {
  beforeEach(async () => { await seedConversation(); });

  it('a peer retracting a message removes it from the page a reload reads', async () => {
    const { handleMessagingLayerCommand } = await import('../message-handler-routing');
    const { MessagingLayerType } = await import('@/types/messaging-layer');

    const conversation: Record<string, unknown> = {
      peerCid: PEER, peerUsername: 'peer',
      messages: [
        { id: 'keep-me', senderCid: PEER, content: 'still here' },
        { id: 'retract-me', senderCid: PEER, content: 'oops' },
      ],
    };

    const config: Record<string, unknown> = {
      getCurrentCid: async (): Promise<bigint> => OWNER,
      isConnected: (): boolean => true,
      getOrCreateConversation: () => conversation,
      addMessageToConversation: async (): Promise<boolean> => true,
      updateMessageInPages: (peerCid: bigint, id: string, u: Record<string, unknown>): Promise<boolean> =>
        messagePaginationStore.updateMessageInPages(peerCid, id, u as never),
      removeMessageFromPages: (peerCid: bigint, id: string): Promise<boolean> =>
        messagePaginationStore.removeMessageFromPages(peerCid, id),
      getConversations: () => new Map(),
      notifyMessageListeners: (): void => {},
      notifyMessageStatusListeners: (): void => {},
      notifyTypingListeners: (): void => {},
      notifyPresenceListeners: (): void => {},
      sendMessageAck: async (): Promise<void> => undefined,
      handleCheckState: async (): Promise<void> => undefined,
      handleCheckStateResponse: (): void => {},
      markPeerReady: (): void => {},
      shouldShowNotification: (): boolean => false,
      addNotification: (): void => {},
    };

    await handleMessagingLayerCommand(
      config as never,
      { handleFileTransferMessage: async (): Promise<void> => undefined } as never,
      { layer: { type: MessagingLayerType.MessageDelete, message_id: 'retract-me', deleted_at: 2_000 } } as never,
      PEER,
    );

    const onReload: P2PMessage[] = await messagePaginationStore.loadLatestMessages(PEER);
    expect(onReload.map((m) => m.id)).toEqual(['keep-me']);
  });
});

describe('my own retraction reaches storage', () => {
  // Sent by me ON DISK too: the stored page is what the sender check reads
  // (message-page-revision), so a fixture whose page and memory disagree about
  // who sent a message is refused, as it should be.
  beforeEach(async () => { await seedConversation(OWNER); });

  it('retracting a message I sent removes it from the page a reload reads', async () => {
    vi.doMock('../current-cid', () => ({ getCurrentCid: async (): Promise<bigint> => OWNER }));
    const { deleteMessage } = await import('../messenger-revision');

    const conversation: Record<string, unknown> = {
      peerCid: PEER, peerUsername: 'peer',
      // Sent by me, so the authorization check in applyDelete permits it.
      messages: [
        { id: 'keep-me', senderCid: OWNER, content: 'still here' },
        { id: 'retract-me', senderCid: OWNER, content: 'oops' },
      ],
    };
    const conversationManager: Record<string, unknown> = { getConversation: (): Record<string, unknown> => conversation };

    const sent: string[] = [];
    await deleteMessage(
      conversationManager as never,
      (): void => {},
      async (_peer: bigint, layer: { type: string }): Promise<void> => { sent.push(layer.type); },
      PEER,
      'retract-me',
    );

    // The wire send still happens -- this is about the local page, not instead of it.
    expect(sent).toEqual(['MessageDelete']);

    const onReload: P2PMessage[] = await messagePaginationStore.loadLatestMessages(PEER);
    expect(onReload.map((m) => m.id)).toEqual(['keep-me']);
  });
});
