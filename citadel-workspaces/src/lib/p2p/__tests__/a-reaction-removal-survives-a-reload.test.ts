/**
 * Live defect: bob reacted 👍 to alice's message, alice reloaded, bob clicked
 * his chip to take it back -- and alice kept showing "Bob reacted with 👍".
 *
 * Cause: `ConversationManager.loadFromStorage` restores every conversation
 * with EMPTY `messages`. The inbound reaction looked for its message only in
 * that window, found nothing, and dropped the removal as "unknown-message",
 * while the add it retracted sat in the stored page and kept rendering. The
 * add had survived the reload only because it was written before it.
 *
 * Replayed here with the real ConversationManager, inbound router and page
 * store on both sides of a reload (`vi.resetModules()`); only the LocalDB
 * transport is a Map, and it persists across the reload as disk does.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { P2PMessage } from '../p2p-types';

const disk: Map<string, string> = vi.hoisted(() => new Map<string, string>());

vi.mock('@/lib/p2p-auto-connect-service', () => ({
  p2pAutoConnectService: {
    markChannelReady: (): void => {},
    isPeerConnected: async (): Promise<boolean> => true,
    ensurePeerConnectedInBackground: async (): Promise<undefined> => undefined,
  },
}));
vi.mock('../../websocket-service', () => ({
  websocketService: {
    sendLocalDBGet: async (_cid: bigint, key: string): Promise<{ value: string }> => {
      const value: string | undefined = disk.get(key);
      if (value === undefined) throw new Error(`no such key: ${key}`);
      return { value };
    },
    sendLocalDBSet: async (_cid: bigint, key: string, value: number[]): Promise<void> => { disk.set(key, String.fromCharCode(...value)); },
    sendLocalDBDelete: async (_cid: bigint, key: string): Promise<void> => { disk.delete(key); },
    sendLocalDBListKeys: async (_cid: bigint, prefix: string): Promise<string[]> => [...disk.keys()].filter((k) => k.startsWith(prefix)),
  },
}));
vi.mock('@/lib/multi-instance/instance-manager', async (importOriginal: () => Promise<typeof import('@/lib/multi-instance/instance-manager')>) => {
  const { instanceManagerWith } = await import('@/test/instance-manager-double');
  const real: typeof import('@/lib/multi-instance/instance-manager') = await importOriginal();
  return { ...real, instanceManager: instanceManagerWith(real.instanceManager, { cid: 4242n }) };
});
// Each `vi.resetModules()` "reload" would open another real BroadcastChannel
// while the earlier one still listens -- two tabs to the channel, whose twin-tab
// repair then calls into the instanceManager stub above. Tabs are not what this
// file measures, so the channel is inert.
vi.mock('@/lib/multi-instance/instance-channel', () => ({
  instanceChannel: new Proxy({}, { get: (): (() => undefined) => (): undefined => undefined }),
}));
vi.mock('../current-cid', () => ({ getCurrentCid: async (): Promise<bigint> => 4242n }));
// Held across the reloads as the real module: it and the connection layer behind
// it are ~130 modules that hold no conversation, and every reset module is a
// round trip to the vitest main process -- seconds per reload on a loaded
// runner. See an-edit-or-delete-survives-a-reload for the measurements.
vi.mock('@/lib/p2p-registration-service', async (importOriginal) => importOriginal());

// Transformed at collection, which no test timeout measures, not in the first test.
import '../conversation-manager';
import '../message-handler-routing';
import '../messenger-reaction';
import '../message-pagination-store';

const ALICE: bigint = 4242n; // this device
const BOB: bigint = 777n;

interface Side {
  receive: (emoji: string, active: boolean, at: number) => Promise<void>;
  press: (emoji: string) => Promise<Array<{ active: boolean }>>;
  reload: () => Promise<P2PMessage>;
}

/** Boot this device: fresh modules, conversations restored from disk the way a page load does. */
async function boot(): Promise<Side> {
  vi.resetModules();
  const { ConversationManager } = await import('../conversation-manager');
  const { messagePaginationStore } = await import('../message-pagination-store');
  const { handleMessagingLayerCommand } = await import('../message-handler-routing');
  const { reactToMessage } = await import('../messenger-reaction');
  const { MessagingLayerType } = await import('@/types/messaging-layer');
  const manager: InstanceType<typeof ConversationManager> = new ConversationManager({
    getCurrentCid: async (): Promise<bigint> => ALICE, maxMessagesPerConversation: 100, maxQueueSize: 100,
  });
  await manager.loadFromStorage();

  const config: Record<string, unknown> = {
    getCurrentCid: async (): Promise<bigint> => ALICE,
    isConnected: (): boolean => true,
    getOrCreateConversation: (cid: bigint) => manager.getOrCreateConversation(cid),
    addMessageToConversation: async (): Promise<boolean> => true,
    updateMessageInPages: (cid: bigint, id: string, u: Partial<P2PMessage>): Promise<boolean> => messagePaginationStore.updateMessageInPages(cid, id, u),
    removeMessageFromPages: async (): Promise<boolean> => true,
    getConversations: () => new Map(),
    notifyMessageListeners: (): void => {}, notifyMessageStatusListeners: (): void => {},
    notifyTypingListeners: (): void => {}, notifyPresenceListeners: (): void => {},
    sendMessageAck: async (): Promise<void> => undefined,
    handleCheckState: async (): Promise<void> => undefined, handleCheckStateResponse: (): void => {},
    markPeerReady: (): void => {}, shouldShowNotification: (): boolean => false, addNotification: (): void => {},
  };
  return {
    receive: (emoji: string, active: boolean, at: number): Promise<void> => handleMessagingLayerCommand(
      config as never, { handleFileTransferMessage: async (): Promise<void> => undefined } as never,
      { layer: { type: MessagingLayerType.MessageReaction, message_id: 'm1', emoji, active, reacted_at: at } } as never, BOB,
    ),
    press: async (emoji: string): Promise<Array<{ active: boolean }>> => {
      const sent: Array<{ active: boolean }> = [];
      await reactToMessage(manager, (): void => {}, async (_p: bigint, layer: unknown): Promise<void> => { sent.push(layer as { active: boolean }); }, BOB, 'm1', emoji);
      return sent;
    },
    reload: async (): Promise<P2PMessage> => (await messagePaginationStore.loadLatestMessages(BOB))[0],
  };
}

const live = (m: P2PMessage): string[] => (m.reactions ?? []).filter((r) => r.active).map((r) => `${r.reactorCid}:${r.emoji}`);

beforeEach(async () => {
  disk.clear();
  vi.resetModules();
  const { saveMetadata, saveMessagePage } = await import('../message-page-operations');
  const m1: P2PMessage = { id: 'm1', content: 'hi', senderCid: ALICE, recipientCid: BOB, timestamp: 1_000, index: 0, status: 'delivered', message_type: 'text' };
  await saveMetadata(BOB, {
    peerCid: BOB, ownerCid: ALICE, peerUsername: 'bob', totalMessageCount: 1, oldestMessageTimestamp: 1_000,
    newestMessageTimestamp: 1_000, latestPage: 0, messagesPerPage: 50, unreadCount: 0, lastMessageIndex: 0, lastUpdated: 1_000,
  });
  await saveMessagePage(BOB, 0, { peerCid: BOB, pageNumber: 0, messages: [m1], pageTimestamps: { minTimestamp: 1_000, maxTimestamp: 1_000 } });
});

describe("a peer's removal after the receiver reloads", () => {
  it('starts from a restored window that holds no messages', async () => {
    // Positive control for the premise: if loadFromStorage ever restores
    // messages, this test stops describing the live defect and says so.
    vi.resetModules();
    const { ConversationManager } = await import('../conversation-manager');
    const manager: InstanceType<typeof ConversationManager> = new ConversationManager({ getCurrentCid: async (): Promise<bigint> => ALICE, maxMessagesPerConversation: 100, maxQueueSize: 100 });
    await manager.loadFromStorage();
    expect(manager.getConversation(BOB)?.messages).toEqual([]);
  });

  it('takes the reaction off what the next reload shows', async () => {
    const before: Side = await boot();
    await before.receive('👍', true, 5);
    expect(live(await before.reload())).toEqual([`${BOB}:👍`]);

    const after: Side = await boot();
    await after.receive('👍', false, 6);
    expect(live(await after.reload())).toEqual([]);
  });

  it('still ignores a late copy of the add after the removal', async () => {
    await (await boot()).receive('👍', true, 5);
    const after: Side = await boot();
    await after.receive('👍', false, 6);
    await after.receive('👍', true, 5);
    expect(live(await after.reload())).toEqual([]);
  });
});

describe('my own chip after I reload', () => {
  it('removes my reaction rather than failing or re-adding it', async () => {
    expect((await (await boot()).press('🎉')).map((l) => l.active)).toEqual([true]);
    const after: Side = await boot();
    expect((await after.press('🎉')).map((l) => l.active)).toEqual([false]);
    expect(live(await after.reload())).toEqual([]);
  });
});
