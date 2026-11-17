/**
 * The sender of a file saw nothing in their own conversation.
 *
 * `announceTransfer` sent the offer that gives the RECIPIENT a bubble, and
 * nothing added one on the sending side: the thread had no trace of the file,
 * so there was nothing to watch, cancel or open. `recordOutgoingFileTransfer`
 * is the missing step; these pin what it records.
 *
 * No mocks: the recorder takes its three effects as injected functions, and the
 * harness below records what it was asked to do.
 */
import { describe, it, expect } from 'vitest';
import { recordOutgoingFileTransfer } from '../record-outgoing-file-transfer';
import { buildTransferAnnouncement, buildLayerPayload } from '@/lib/file-transfer/transfer-announcement';
import { createFileTransferResponse } from '@/types/messaging-layer';
import type { FileTransfer } from '@/lib/file-transfer/types';
import type { P2PMessage } from '../p2p-types';
import type { P2PMessagingLayerPayload } from '@/types/p2p-commands';

const ME: bigint = 100n;
const PEER: bigint = 900n;

function transfer(): FileTransfer {
  return {
    id: 't-1',
    fileName: 'notes.md',
    fileSize: 1024,
    fileType: 'text/markdown',
        state: 'pending',
    progress: 0,
    senderCid: ME.toString(),
    recipientCid: PEER.toString(),
    createdAt: 1,
    updatedAt: 1,
    expiresAt: 2,
    isIncoming: false,
  };
}

interface Recorded {
  added: Array<{ peer: bigint; message: P2PMessage }>;
  notified: P2PMessage[];
  events: string[];
}

function harness(alreadyPresent: boolean = false): { recorded: Recorded; deps: Parameters<typeof recordOutgoingFileTransfer>[0] } {
  const recorded: Recorded = { added: [], notified: [], events: [] };
  return {
    recorded,
    deps: {
      addMessageToConversation: async (peer: bigint, message: P2PMessage): Promise<boolean> => {
        recorded.added.push({ peer, message });
        return !alreadyPresent;
      },
      notifyMessageListeners: (message: P2PMessage): void => { recorded.notified.push(message); },
      emitEvent: (event: string): void => { recorded.events.push(event); },
    },
  };
}

describe("the sender's own file offer", () => {
  it('is added to the conversation with the recipient, as the sender\'s message', async (): Promise<void> => {
    const { recorded, deps } = harness();
    const announcement: P2PMessagingLayerPayload = buildTransferAnnouncement(transfer());

    await recordOutgoingFileTransfer(deps, announcement, 'pending');

    expect(recorded.added).toHaveLength(1);
    const { peer, message } = recorded.added[0];
    expect(peer, 'filed under the wrong conversation').toBe(PEER);
    expect(message.senderCid, 'not shown as the sender\'s own bubble').toBe(ME);
    expect(message.message_type).toBe('file_transfer');
    expect(message.transfer_id, 'the bubble cannot follow its transfer').toBe('t-1');
    expect(message.transfer_state).toBe('pending');
    expect(message.status).toBe('sent');
    // The recipient acknowledges by message id; the sender's entry must carry
    // the SAME id or receipts never reach it.
    expect(message.id).toBe(announcement.message_id);
  });

  it('is announced to the thread, so it renders without a reload', async (): Promise<void> => {
    const { recorded, deps } = harness();

    await recordOutgoingFileTransfer(deps, buildTransferAnnouncement(transfer()), 'staged');

    expect(recorded.notified).toHaveLength(1);
    expect(recorded.events).toEqual(['p2p:message-sent']);
  });

  it('is not re-announced when the conversation already holds it', async (): Promise<void> => {
    const { recorded, deps } = harness(true);

    await recordOutgoingFileTransfer(deps, buildTransferAnnouncement(transfer()), 'pending');

    expect(recorded.notified).toEqual([]);
    expect(recorded.events).toEqual([]);
  });

  it('refuses a payload that is not an offer', async (): Promise<void> => {
    const { recorded, deps } = harness();
    const response: P2PMessagingLayerPayload = buildLayerPayload(createFileTransferResponse('t-1', true), ME, PEER);

    await expect(recordOutgoingFileTransfer(deps, response, 'pending')).rejects.toThrow(/not a file-transfer offer/);
    expect(recorded.added).toEqual([]);
  });
});
