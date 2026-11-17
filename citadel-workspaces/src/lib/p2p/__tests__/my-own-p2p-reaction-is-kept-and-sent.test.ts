/**
 * Reacting to a P2P message: stored before it is sent, sent as the reaction
 * variant, and a second press takes it back.
 *
 * Same ordering contract as editing (messenger-revision): a storage failure
 * must stop the send, or the peer holds a reaction our own reload loses.
 * The real page store runs over a Map standing in for LocalDB, which can be
 * told to refuse writes.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { P2PMessage } from '../p2p-types';
import type { MessagingLayer } from '@/types/messaging-layer';

const PEER: bigint = 777n;
const OWNER: bigint = 4242n;
const world: { writable: boolean; disk: Map<string, string> } = vi.hoisted(() => ({ writable: true, disk: new Map<string, string>() }));

vi.mock('../current-cid', () => ({ getCurrentCid: async (): Promise<bigint> => 4242n }));
vi.mock('@/lib/multi-instance/instance-manager', async (importOriginal: () => Promise<typeof import('@/lib/multi-instance/instance-manager')>) => {
  const { instanceManagerWith } = await import('@/test/instance-manager-double');
  const real: typeof import('@/lib/multi-instance/instance-manager') = await importOriginal();
  return { ...real, instanceManager: instanceManagerWith(real.instanceManager, { cid: 4242n }) };
});
vi.mock('../../websocket-service', () => ({
  websocketService: {
    sendLocalDBGet: async (_cid: bigint, key: string): Promise<{ value: string }> => {
      const value: string | undefined = world.disk.get(key);
      if (value === undefined) throw new Error(`no such key: ${key}`);
      return { value };
    },
    sendLocalDBSet: async (_cid: bigint, key: string, value: number[]): Promise<void> => {
      if (!world.writable) throw new Error('LocalDB timed out');
      world.disk.set(key, String.fromCharCode(...value));
    },
    sendLocalDBDelete: async (_cid: bigint, key: string): Promise<void> => { world.disk.delete(key); },
  },
}));

const { reactToMessage } = await import('../messenger-reaction');
const { messagePaginationStore } = await import('../message-pagination-store');
const { saveMetadata, saveMessagePage } = await import('../message-page-operations');

let conversation: { messages: P2PMessage[] };
let sent: MessagingLayer[];
const manager: Record<string, unknown> = { getConversation: () => conversation };
const send = async (_peer: bigint, layer: MessagingLayer): Promise<void> => { sent.push(layer); };
const press = (emoji: string): Promise<void> => reactToMessage(manager as never, (): void => {}, send, PEER, 'm1', emoji);
const m1 = (): P2PMessage => ({ id: 'm1', content: 'hi', senderCid: PEER, recipientCid: OWNER, timestamp: 1, index: 0, status: 'delivered', message_type: 'text' });

beforeEach(async () => {
  world.writable = true;
  world.disk.clear();
  sent = [];
  conversation = { messages: [m1()] };
  await saveMetadata(PEER, {
    peerCid: PEER, ownerCid: OWNER, peerUsername: 'peer', totalMessageCount: 1, oldestMessageTimestamp: 1,
    newestMessageTimestamp: 1, latestPage: 0, messagesPerPage: 50, unreadCount: 0, lastMessageIndex: 0, lastUpdated: 1,
  });
  await saveMessagePage(PEER, 0, { peerCid: PEER, pageNumber: 0, messages: [m1()], pageTimestamps: { minTimestamp: 1, maxTimestamp: 1 } });
});

describe('my own reaction', () => {
  it('is stored with the message and sent as a MessageReaction', async () => {
    await press('🎉');
    const [stored]: P2PMessage[] = await messagePaginationStore.loadLatestMessages(PEER);
    expect(stored.reactions?.map((r) => [r.emoji, r.reactorCid, r.active])).toEqual([['🎉', OWNER, true]]);
    expect(sent.map((l) => [l.type, (l as { emoji?: string }).emoji, (l as { active?: boolean }).active])).toEqual([['MessageReaction', '🎉', true]]);
  });

  it('is taken back by a second press, in memory and on disk', async () => {
    await press('🎉');
    await press('🎉');
    expect(sent.map((l) => (l as { active?: boolean }).active)).toEqual([true, false]);
    expect(conversation.messages[0].reactions?.filter((r) => r.active)).toEqual([]);
    const [stored]: P2PMessage[] = await messagePaginationStore.loadLatestMessages(PEER);
    expect(stored.reactions?.filter((r) => r.active)).toEqual([]);
  });

  it('is not sent when it could not be stored', async () => {
    world.writable = false;
    await expect(press('🎉')).rejects.toThrow();
    expect(sent).toEqual([]);
  });
});
