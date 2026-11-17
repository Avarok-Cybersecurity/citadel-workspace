/**
 * The wiring half of "the sender sees their own file offer".
 *
 * `recordOutgoingFileTransfer` is pinned in lib/p2p; this pins that the offer
 * `announceTransfer` actually SENT is the one handed to it -- same payload, so
 * the same message id the recipient will acknowledge -- and that the binding the
 * messenger installs turns that event into a recorded entry.
 *
 * The one stub is the wire (`sendLayerPayload`), which is network I/O; the event
 * bus and the recorder are the real ones.
 */
import { describe, it, expect, vi } from 'vitest';

const sent: unknown[] = [];
vi.mock('../in-band-signals', () => ({
  sendLayerPayload: async (payload: unknown): Promise<void> => { sent.push(payload); },
}));

const { announceTransfer } = await import('../send-transfer-request');
const { eventEmitter } = await import('../../event-emitter');
const { bindOutgoingFileOffers } = await import('../../p2p/record-outgoing-file-transfer');
import type { FileTransfer } from '../types';
import type { P2PMessage } from '../../p2p/p2p-types';

function transfer(): FileTransfer {
  return {
    id: 'transfer-1', fileName: 'notes.md', fileSize: 4, fileType: 'text/markdown',
    state: 'pending', progress: 0,
    senderCid: '7', recipientCid: '42',
    createdAt: 0, updatedAt: 0, isIncoming: false,
  };
}

describe('announcing an offer', () => {
  it("records the offer it sent in the sender's own conversation", async (): Promise<void> => {
    const added: Array<{ peer: bigint; message: P2PMessage }> = [];
    const handlers: Array<(data: never) => void> = [];
    bindOutgoingFileOffers(
      (event, handler) => {
        eventEmitter.on(event, handler);
        handlers.push(handler as (data: never) => void);
      },
      {
        addMessageToConversation: async (peer: bigint, message: P2PMessage): Promise<boolean> => {
          added.push({ peer, message });
          return true;
        },
        notifyMessageListeners: (): void => {},
        emitEvent: (): void => {},
      },
    );

    try {
      await announceTransfer(transfer(), false);
      await vi.waitFor(() => expect(added).toHaveLength(1));
    } finally {
      for (const handler of handlers) eventEmitter.off('file-transfer:offer-announced', handler);
    }

    expect(sent, 'the offer never went to the recipient').toHaveLength(1);
    const wire: { message_id: string } = sent[0] as { message_id: string };
    expect(added[0].peer).toBe(42n);
    expect(added[0].message.id, 'the recorded entry is not the offer that was sent').toBe(wire.message_id);
    expect(added[0].message.senderCid).toBe(7n);
    expect(added[0].message.transfer_state).toBe('pending');
  });
});
