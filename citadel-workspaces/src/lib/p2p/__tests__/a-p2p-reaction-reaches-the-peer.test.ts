/**
 * A P2P reaction travels as a MessagingLayer variant, lands on the peer's copy
 * of the message, and is still there after a reload.
 *
 * Driven through the real CBOR envelope, the real inbound router and the real
 * page store; only the LocalDB transport is a Map. Assertions read what a
 * RELOAD reads (`loadLatestMessages`), because a reaction that lives only in
 * memory is exactly the failure that edits and deletes each shipped with once.
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
/** Writes of a message PAGE -- where a reaction is stored -- whoever makes them. */
let pageWrites: number = 0;
vi.mock('../../websocket-service', () => ({
  websocketService: {
    sendLocalDBGet: async (_cid: bigint, key: string): Promise<{ value: string }> => {
      const value: string | undefined = stored.get(key);
      if (value === undefined) throw new Error(`no such key: ${key}`);
      return { value };
    },
    sendLocalDBSet: async (_cid: bigint, key: string, value: number[]): Promise<void> => {
      if (/_\d+$/.test(key)) pageWrites += 1;
      stored.set(key, String.fromCharCode(...value));
    },
    sendLocalDBDelete: async (_cid: bigint, key: string): Promise<void> => { stored.delete(key); },
  },
}));
vi.mock('@/lib/multi-instance/instance-manager', async (importOriginal: () => Promise<typeof import('@/lib/multi-instance/instance-manager')>) => {
  const { instanceManagerWith } = await import('@/test/instance-manager-double');
  const real: typeof import('@/lib/multi-instance/instance-manager') = await importOriginal();
  return { ...real, instanceManager: instanceManagerWith(real.instanceManager, { cid: 4242n }) };
});

const { messagePaginationStore } = await import('../message-pagination-store');
const { saveMetadata, saveMessagePage } = await import('../message-page-operations');
const { handleMessagingLayerCommand } = await import('../message-handler-routing');
const { MessagingLayerType } = await import('@/types/messaging-layer');
const { createMessagingLayerCommand, serializeP2PCommand, deserializeP2PCommand } = await import('@/types/p2p-commands');

const PEER: bigint = 777n;
const OWNER: bigint = 4242n;
const FORGED: bigint = 999n;

let conversation: { peerCid: bigint; messages: P2PMessage[] };
let writes: number;
let added: number;

function msg(id: string): P2PMessage {
  return { id, content: 'hi', senderCid: OWNER, recipientCid: PEER, timestamp: 1_000, index: 0, status: 'delivered', message_type: 'text' };
}

const config: Record<string, unknown> = {
  getCurrentCid: async (): Promise<bigint> => OWNER,
  isConnected: (): boolean => true,
  getOrCreateConversation: () => conversation,
  addMessageToConversation: async (): Promise<boolean> => { added += 1; return true; },
  updateMessageInPages: (peerCid: bigint, id: string, u: Partial<P2PMessage>): Promise<boolean> => {
    writes += 1;
    return messagePaginationStore.updateMessageInPages(peerCid, id, u);
  },
  removeMessageFromPages: async (): Promise<boolean> => true,
  getConversations: () => new Map(),
  notifyMessageListeners: (): void => { added += 1; },
  notifyMessageStatusListeners: (): void => {}, notifyTypingListeners: (): void => {}, notifyPresenceListeners: (): void => {},
  sendMessageAck: async (): Promise<void> => undefined,
  handleCheckState: async (): Promise<void> => undefined, handleCheckStateResponse: (): void => {},
  markPeerReady: (): void => {}, shouldShowNotification: (): boolean => false, addNotification: (): void => {},
};

/** Encode as the sender would, decode as the receiver does, and route it. */
async function receive(layer: Record<string, unknown>): Promise<void> {
  // sender_cid is the SENDER's claim; set to a third party to prove it is not trusted.
  const bytes: Uint8Array = serializeP2PCommand(createMessagingLayerCommand(layer as never, FORGED, OWNER, 0));
  const command: ReturnType<typeof deserializeP2PCommand> = deserializeP2PCommand(bytes);
  await handleMessagingLayerCommand(config as never, { handleFileTransferMessage: async (): Promise<void> => undefined } as never, command.payload as never, PEER);
}

const reaction = (emoji: string, active: boolean, at: number): Record<string, unknown> => ({
  type: MessagingLayerType.MessageReaction, message_id: 'm1', emoji, active, reacted_at: at,
});

beforeEach(async () => {
  stored.clear();
  writes = 0;
  added = 0;
  conversation = { peerCid: PEER, messages: [msg('m1')] };
  await saveMetadata(PEER, {
    peerCid: PEER, ownerCid: OWNER, peerUsername: 'peer', totalMessageCount: 1, oldestMessageTimestamp: 1_000,
    newestMessageTimestamp: 1_000, latestPage: 0, messagesPerPage: 50, unreadCount: 0, lastMessageIndex: 0, lastUpdated: 1_000,
  });
  await saveMessagePage(PEER, 0, { peerCid: PEER, pageNumber: 0, messages: [msg('m1')], pageTimestamps: { minTimestamp: 1_000, maxTimestamp: 1_000 } });
});

describe("a peer's reaction", () => {
  it('survives the CBOR envelope intact', () => {
    const bytes: Uint8Array = serializeP2PCommand(createMessagingLayerCommand(reaction('👍', true, 5) as never, PEER, OWNER, 0));
    expect((deserializeP2PCommand(bytes).payload as { layer: unknown }).layer).toEqual(reaction('👍', true, 5));
  });

  it('is stored with the message and read back on reload, with a bigint reactor', async () => {
    await receive(reaction('👍', true, 5));
    const [reloaded]: P2PMessage[] = await messagePaginationStore.loadLatestMessages(PEER);
    expect(reloaded.reactions).toEqual([{ emoji: '👍', reactorCid: PEER, at: 5, active: true }]);
  });

  it('is credited to the transport peer, never to the sender_cid in the body', async () => {
    await receive(reaction('👍', true, 5));
    expect(conversation.messages[0].reactions?.map((r) => r.reactorCid)).toEqual([PEER]);
  });

  it('is written once however often it is redelivered', async () => {
    pageWrites = 0;
    await receive(reaction('👍', true, 5));
    await receive(reaction('👍', true, 5));
    expect(pageWrites).toBe(1);
  });

  it('can be retracted, and the retraction is what a reload shows', async () => {
    await receive(reaction('👍', true, 5));
    await receive(reaction('👍', false, 6));
    const [reloaded]: P2PMessage[] = await messagePaginationStore.loadLatestMessages(PEER);
    expect(reloaded.reactions?.filter((r) => r.active)).toEqual([]);
  });

  it('never becomes a message', async () => {
    await receive(reaction('👍', true, 5));
    expect(added).toBe(0);
  });
});

/**
 * What an OLDER client does with this variant: it has no case for it. The
 * property that protects it is the router's default arm -- an unknown layer
 * type is dropped, not rendered -- so that is pinned here with a type this
 * build does not know either.
 */
describe('a layer type the receiver does not know', () => {
  it('is dropped without producing a message or a write', async () => {
    pageWrites = 0;
    await receive({ type: 'SomethingFromANewerBuild', message_id: 'm1', emoji: '👍' });
    expect(added).toBe(0);
    expect(writes).toBe(0);
    expect(pageWrites).toBe(0);
  });
});
