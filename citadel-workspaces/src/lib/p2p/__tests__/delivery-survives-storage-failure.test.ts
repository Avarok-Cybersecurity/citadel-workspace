/**
 * A message that arrived must be shown, even when it cannot be stored.
 *
 * `addMessageToConversation` pushes to the in-memory conversation and THEN
 * awaits the page write, which rejects on a LocalDB timeout. That rejection
 * unwound past the delivery ACK, the render notification and the desktop
 * notification — all of which sit inside one `if (wasAdded)` — so a storage
 * hiccup discarded a message that had genuinely arrived and was already in
 * memory. Nothing rendered, nothing was notified, and the only trace was a log
 * line reading "Failed to deserialize P2P command", which it had not.
 *
 * Durability is a separate concern from delivery. Conflating them lost both.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/p2p-auto-connect-service', () => ({
  p2pAutoConnectService: {
    markChannelReady: (): void => {},
    isPeerConnected: async (): Promise<boolean> => true,
    ensurePeerConnectedInBackground: async (): Promise<undefined> => undefined,
  },
}));

import { handleMessagingLayerCommand } from '@/lib/p2p/message-handler-routing';
import type { MessageHandlerConfig } from '@/lib/p2p/message-handler-types';
import { MessagingLayerType } from '@/types/messaging-layer';
import type { FileTransferMessageHandler } from '@/lib/p2p/file-transfer-message-handler';

const PEER: bigint = 42n;
const ME: bigint = 7n;

function harness(addBehaviour: () => Promise<boolean>): { rendered: string[]; acked: string[]; notified: string[]; run: () => Promise<void>; } {
  const rendered: string[] = [];
  const acked: string[] = [];
  const notified: string[] = [];

  const config: MessageHandlerConfig = {
    getCurrentCid: async () => ME,
    isConnected: () => true,
    getOrCreateConversation: () => ({ peerCid: PEER, messages: [], peerUsername: 'alice' }),
    addMessageToConversation: addBehaviour,
    updateMessageInPages: async () => true,
    getConversations: () => new Map([[PEER, { peerUsername: 'alice' }]]),
    notifyMessageListeners: (m: { id: string }) => rendered.push(m.id),
    notifyMessageStatusListeners: () => {},
    notifyTypingListeners: () => {},
    notifyPresenceListeners: () => {},
    sendMessageAck: async (id: string) => {
      acked.push(id);
    },
    handleCheckState: async () => {},
    handleCheckStateResponse: () => {},
    markPeerReady: () => {},
    shouldShowNotification: () => true,
    addNotification: (_t: string, _b: string, _s: string, messageId: string) => {
      notified.push(messageId);
    },
  } as unknown as MessageHandlerConfig;

  const payload: never = {
    layer: { type: MessagingLayerType.Message, contents: 'hello', timestamp: 1 },
    message_id: 'm-1',
    index: 1,
    recipient_cid: ME.toString(),
  } as never;

  const noFileTransfers: FileTransferMessageHandler = {} as FileTransferMessageHandler;

  return {
    rendered,
    acked,
    notified,
    run: (): Promise<void> => handleMessagingLayerCommand(config, noFileTransfers, payload, PEER, ME),
  };
}

describe('an arrived message whose write fails', () => {
  it('is still rendered and still notified', async () => {
    const h: { rendered: string[]; acked: string[]; notified: string[]; run: () => Promise<void>; } = harness(async (): Promise<never> => {
      throw new Error('LocalDB set timed out');
    });

    await h.run();

    expect(h.rendered, 'the message was discarded instead of shown').toHaveLength(1);
    expect(h.notified, 'no notification was raised for a message that arrived').toHaveLength(1);
  });

  it('is NOT acked as delivered, because it will not survive a reload', async () => {
    const h: { rendered: string[]; acked: string[]; notified: string[]; run: () => Promise<void>; } = harness(async (): Promise<never> => {
      throw new Error('LocalDB set timed out');
    });

    await h.run();

    // The ACK is what turns the sender's bubble into "delivered". A message we
    // could not store is gone on the next reload, so claiming delivery would be
    // a lie that outlives the message. Leaving it on 'sent' is accurate.
    expect(h.acked, 'delivery was claimed for a message that was not stored').toHaveLength(0);
  });

  it('acks normally when the write succeeds', async () => {
    const h: { rendered: string[]; acked: string[]; notified: string[]; run: () => Promise<void>; } = harness(async (): Promise<true> => true);

    await h.run();

    expect(h.rendered).toHaveLength(1);
    expect(h.acked).toHaveLength(1);
  });
});
