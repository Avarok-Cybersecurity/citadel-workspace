/**
 * Reading a message is a local fact. Telling the sender is a courtesy.
 *
 * `markMessagesAsRead` awaited `sendMessageAck` INSIDE the loop that marks
 * messages locally, so the courtesy could cancel the fact. One ack that
 * rejected — a peer that has gone away, a socket mid-reconnect — threw out of
 * the loop, and every message after it stayed `delivered`: unread badge intact,
 * transcript wrong, for messages the user demonstrably read.
 *
 * The comment three lines above that loop already stated the rule: "The LOCAL
 * side of 'read' always happens ... Only the ack is the user's to withhold."
 * The code did not implement it.
 *
 * The same `await` also serialised the sends — 200 unread meant 200 sequential
 * P2P round trips before the call returned — which is asserted here too,
 * because a fix that only caught the rejection would leave that in place.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { markMessagesAsRead } from '../messenger-compatibility';
import type { P2PMessage } from '../p2p-types';

vi.mock('@/lib/privacy-settings', (): { getPrivacySettings: () => { sendReadReceipts: boolean } } => ({
  getPrivacySettings: (): { sendReadReceipts: boolean } => ({ sendReadReceipts: true }),
}));
vi.mock('../message-pagination-store', (): { messagePaginationStore: Record<string, unknown> } => ({
  messagePaginationStore: {
    findUnreadFromPeer: async (): Promise<P2PMessage[]> => [],
    updateMessageInPages: async (): Promise<void> => undefined,
    updateUnreadCount: async (): Promise<void> => undefined,
  },
}));

const PEER: bigint = 42n;

function delivered(id: string): P2PMessage {
  return { id, senderCid: PEER, status: 'delivered' } as unknown as P2PMessage;
}

function managerFor(messages: P2PMessage[]): Parameters<typeof markMessagesAsRead>[0] {
  return {
    getConversation: () => ({ messages, unreadCount: messages.length }),
    saveConversations: async () => undefined,
  } as unknown as Parameters<typeof markMessagesAsRead>[0];
}

describe('marking messages read', () => {
  beforeEach(() => vi.clearAllMocks());

  it('marks every message locally even when an ack rejects', async () => {
    const messages: P2PMessage[] = ['m1', 'm2', 'm3'].map(delivered);
    const ack: ReturnType<typeof vi.fn> = vi.fn(async (id: string) => {
      if (id === 'm1') throw new Error('peer went away');
    });

    await markMessagesAsRead(managerFor(messages), ack, vi.fn(), PEER);

    expect(messages.map((m: P2PMessage) => m.status)).toEqual(['read', 'read', 'read']);
  });

  it('does not reject when every ack fails', async () => {
    const messages: P2PMessage[] = [delivered('m1')];
    const ack: ReturnType<typeof vi.fn> = vi.fn(async () => { throw new Error('socket down'); });

    // The caller is a UI event handler. A rejection here surfaces as an
    // unhandled rejection for a courtesy nobody asked about.
    await expect(markMessagesAsRead(managerFor(messages), ack, vi.fn(), PEER)).resolves.toBeUndefined();
  });

  it('sends the receipts concurrently rather than one after another', async () => {
    const messages: P2PMessage[] = ['m1', 'm2', 'm3', 'm4'].map(delivered);
    let inFlight: number = 0;
    let peakInFlight: number = 0;
    const ack: ReturnType<typeof vi.fn> = vi.fn(async () => {
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      await new Promise<void>((r: () => void) => { setTimeout(r, 0); });
      inFlight -= 1;
    });

    await markMessagesAsRead(managerFor(messages), ack, vi.fn(), PEER);

    expect(ack).toHaveBeenCalledTimes(4);
    // Awaited in a loop this is 1. The assertion is on CONCURRENCY, not on
    // wall-clock, because a timing assertion would pass on a fast machine
    // whatever the code did.
    expect(peakInFlight).toBeGreaterThan(1);
  });

  it('sends nothing when there was nothing to mark', async () => {
    // Without this, a fix that acked every message in the conversation
    // regardless of status would satisfy the tests above.
    const read: P2PMessage = { id: 'm1', senderCid: PEER, status: 'read' } as unknown as P2PMessage;
    const ack: ReturnType<typeof vi.fn> = vi.fn(async () => undefined);

    await markMessagesAsRead(managerFor([read]), ack, vi.fn(), PEER);

    expect(ack).not.toHaveBeenCalled();
  });
});
