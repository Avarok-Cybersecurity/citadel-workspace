/**
 * An inbound file-transfer message was acknowledged as delivered and then lost.
 *
 * `FileTransferMessageHandler` builds a `P2PMessage`, pushes it straight onto
 * `conversation.messages`, and sends a `'delivered'` ACK. Its sibling for every
 * other message type — `message-handler-routing.ts` — goes through
 * `addMessageToConversation`, which does three things this one does not:
 *
 *   1. **Dedupes by id.** A redelivered transfer (the sender resends whenever it
 *      misses an ACK) appended a second copy of the same offer, so the same file
 *      appeared twice in the thread with two Accept buttons.
 *   2. **Persists.** The push is in-memory only, so every received file offer
 *      vanished on reload while the sender's bubble still read "delivered".
 *   3. **Counts it.** The unread badge is incremented there.
 *
 * And the ACK: `shouldAck` exists precisely so a message that could not be
 * stored is NOT claimed as delivered — "a message we could not store is gone on
 * the next reload, so claiming delivery would be a lie that outlives the
 * message". This handler acked unconditionally, having never attempted a store.
 *
 * The whole delivery path was built, documented and applied to one of the two
 * handlers that need it.
 */
import { describe, it, expect } from 'vitest';
import { FileTransferMessageHandler } from '../file-transfer-message-handler';
import type { P2PMessage, P2PConversation } from '../p2p-types';
import type { P2PMessagingLayerPayload } from '@/types/p2p-types';

const PEER: bigint = 900n;
const ME: bigint = 100n;

function payload(overrides: Partial<P2PMessagingLayerPayload> = {}): P2PMessagingLayerPayload {
  return {
    message_id: 'ft-1',
    sender_cid: PEER,
    recipient_cid: ME,
    index: 3,
    layer: {
      type: 'FileTransferRequest',
      transfer_id: 't-1',
      file_name: 'notes.md',
      file_size: 1024,
      file_type: 'text/markdown',
      transfer_mode: 'async',
      timestamp: 111,
      virtual_path: '/transfers/t-1/notes.md',
    },
    ...overrides,
  } as unknown as P2PMessagingLayerPayload;
}

interface Harness {
  handler: FileTransferMessageHandler;
  conversation: P2PConversation;
  added: P2PMessage[];
  acks: Array<{ id: string; type: string }>;
  notified: P2PMessage[];
}

function harness(opts: { addFails?: boolean; duplicate?: boolean } = {}): Harness {
  const conversation: P2PConversation = {
    peerCid: PEER, messages: [], lastMessageIndex: 0, unreadCount: 0,
  } as unknown as P2PConversation;

  const added: P2PMessage[] = [];
  const acks: Array<{ id: string; type: string }> = [];
  const notified: P2PMessage[] = [];

  const handler: FileTransferMessageHandler = new FileTransferMessageHandler({
    getOrCreateConversation: (): P2PConversation => conversation,
    notifyMessageListeners: (message: P2PMessage): void => { notified.push(message); },
    sendMessageAck: async (messageId: string, ackType: 'delivered' | 'read' | 'failed'): Promise<void> => {
      acks.push({ id: messageId, type: ackType });
    },
    addMessageToConversation: async (_peer: bigint, message: P2PMessage): Promise<boolean> => {
      void _peer;
      if (opts.addFails) throw new Error('LocalDB timed out');
      if (opts.duplicate) return false;
      added.push(message);
      return true;
    },
  });

  return { handler, conversation, added, acks, notified };
}

describe('an inbound file-transfer offer', () => {
  it('goes through the storing path rather than pushing to memory', async (): Promise<void> => {
    const { handler, added }: Harness = harness();

    await handler.handleFileTransferMessage(payload(), PEER);

    expect(added.map((m) => m.id)).toEqual(['ft-1']);
    expect(added[0].message_type).toBe('file_transfer');
    expect(added[0].file_name).toBe('notes.md');
  });

  it('attributes the message to the transport peer, not the claimed sender', async (): Promise<void> => {
    // Pre-existing and deliberately preserved through this change: trusting
    // `payload.sender_cid` let any registered peer put a file offer in a
    // victim's conversation attributed to a third party.
    const { handler, added }: Harness = harness();

    await handler.handleFileTransferMessage(
      payload({ sender_cid: 424242n } as unknown as Partial<P2PMessagingLayerPayload>),
      PEER,
    );

    expect(added[0].senderCid).toBe(PEER);
  });

  it('does not re-announce an offer that was redelivered', async (): Promise<void> => {
    // The store reports `false` for an id it already holds. `added` alone cannot
    // see this — it is empty both when the store rejects a duplicate and when
    // the store is never consulted at all, which was the defect. What
    // discriminates is whether the thread is told about it a second time.
    const { handler, notified }: Harness = harness({ duplicate: true });

    await handler.handleFileTransferMessage(payload(), PEER);

    expect(notified).toHaveLength(0);
  });

  it('announces an offer that is genuinely new', async (): Promise<void> => {
    const { handler, notified }: Harness = harness();

    await handler.handleFileTransferMessage(payload(), PEER);

    expect(notified.map((m) => m.id)).toEqual(['ft-1']);
  });

  it('does not claim delivery for an offer it could not store', async (): Promise<void> => {
    // shouldAck's whole reason to exist: a message that failed to store is gone
    // on the next reload, so "delivered" would be a lie that outlives it.
    const { handler, acks }: Harness = harness({ addFails: true });

    await handler.handleFileTransferMessage(payload(), PEER);

    expect(acks).toEqual([]);
  });

  it('still acknowledges an offer that stored cleanly', async (): Promise<void> => {
    // The opposite failure: never acking would leave every sender on 'sent'.
    const { handler, acks }: Harness = harness();

    await handler.handleFileTransferMessage(payload(), PEER);

    expect(acks).toEqual([{ id: 'ft-1', type: 'delivered' }]);
  });
});
