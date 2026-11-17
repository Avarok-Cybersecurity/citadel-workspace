/**
 * A file-transfer bubble shows the transfer as the service knows it.
 *
 * Seen live: offers restored after a reload still read "wants to send you a
 * file — Accept / Decline" hours later, and Accept only threw "Transfer not
 * found". And a failed transfer read "Transfer failed" with no reason, though
 * the agent's Fail tick carries one.
 *
 * Both came from the bubble rendering the state stamped on the conversation
 * entry when the offer arrived, which is what the page store restores, instead
 * of the service's record. The real service, router and parser are driven here;
 * mocked are the socket to the agent (I/O boundary) and the tab's session
 * lookup (IndexedDB).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';

vi.mock('@/lib/tab-context', () => ({
  getSelectedUser: async (): Promise<{ selectedCid: bigint }> => ({ selectedCid: 7n }),
}));
const sendRequest: ReturnType<typeof vi.fn> = vi.fn(async (_request: unknown): Promise<void> => undefined);
vi.mock('@/lib/websocket-service', () => ({
  websocketService: {
    sendRequest: (r: unknown): Promise<void> => sendRequest(r),
    sendP2PMessageReliable: async (): Promise<void> => undefined,
    // In-band signals open this session's messenger first; see in-band-signals.
    ensureMessengerOpen: async (): Promise<boolean> => false,
    canSendRequests: (): boolean => false,
  },
}));

import { FileTransferBubble } from '../FileTransferBubble';
import { eventEmitter } from '@/lib/event-emitter';
import { fileTransferService } from '@/lib/file-transfer';
import { MessagingLayerType } from '@/types/messaging-layer';
import type { P2PMessage } from '@/lib/p2p';
import type { VirtualObjectMetadata } from '@/lib/file-transfer/protocol-types';
import { scopedTransfersKey } from '@/lib/file-transfer/settings-key';

afterEach(cleanup);

const BOB: bigint = 7n;
const ALICE: bigint = 42n;

function offerEntry(transferId: string): P2PMessage {
  return {
    id: `msg-${transferId}`, content: 'File transfer: a.bin', senderCid: ALICE, recipientCid: BOB,
    timestamp: 1, status: 'delivered', message_type: 'file_transfer', transfer_id: transferId,
    file_name: 'a.bin', file_size: 3000, transfer_mode: 'p2p', transfer_state: 'pending',
  } as P2PMessage;
}

const settle = (): Promise<void> => act(async (): Promise<void> => { await new Promise((r) => setTimeout(r, 0)); });

/** Announce an offer over both planes, exactly as a live one arrives. */
function announce(transferId: string, objectId: bigint): void {
  eventEmitter.emit('p2p:file-transfer-message', {
    layer: {
      type: MessagingLayerType.FileTransferRequest, transfer_id: transferId, file_name: 'a.bin',
      file_size: 3000, file_type: '', transfer_mode: 'p2p', timestamp: Date.now(),
      expiry_timestamp: Date.now() + 60_000,
    },
    senderCid: ALICE.toString(), recipientCid: BOB.toString(),
  });
  const metadata: VirtualObjectMetadata = {
    name: 'a.bin', date_created: '', author: 'alice', plaintext_length: 3000, group_count: 1,
    object_id: objectId, cid: ALICE, transfer_type: 'FileTransfer',
  } as VirtualObjectMetadata;
  eventEmitter.emit('websocket-message', {
    FileTransferRequestNotification: { cid: BOB, peer_cid: ALICE, metadata, request_id: null },
  });
}

describe('a file-transfer bubble', () => {
  it('does not offer Accept on a restored offer nothing can answer', () => {
    render(<FileTransferBubble message={offerEntry('restored-1')} isOwn={false} onAccept={(): void => undefined} />);

    expect(screen.queryByRole('button', { name: /^accept$/i }), 'a dead offer kept its Accept button').toBeNull();
    expect(screen.getByTestId('file-transfer-bubble').getAttribute('data-transfer-state')).toBe('expired');
    expect(screen.getByText(/offer expired — ask the sender to send it again/i)).toBeTruthy();
  });

  it('still offers Accept on an offer that arrived in this page, before its record is written', () => {
    announce('live-1', 1n);
    render(<FileTransferBubble message={offerEntry('live-1')} isOwn={false} onAccept={(): void => undefined} />);

    expect(screen.getByRole('button', { name: /^accept$/i })).toBeTruthy();
  });

  it('picks up a history record that loads after it rendered', async () => {
    // The account's history loads on instance:cid-changed, typically after the
    // restored transcript has rendered. A finished download must not stay
    // "expired" just because its record arrived second.
    render(<FileTransferBubble message={offerEntry('history-1')} isOwn={false} />);
    expect(screen.getByTestId('file-transfer-bubble').getAttribute('data-transfer-state')).toBe('expired');

    localStorage.setItem(scopedTransfersKey(), JSON.stringify({
      'history-1': {
        id: 'history-1', fileName: 'a.bin', fileSize: 3000, state: 'complete', isIncoming: true,
        mode: 'p2p', senderCid: '42', recipientCid: '7', createdAt: 1, updatedAt: Date.now(),
      },
    }));
    act((): void => { eventEmitter.emit('instance:cid-changed', { cid: BOB }); });
    await settle();

    expect(screen.getByTestId('file-transfer-bubble').getAttribute('data-transfer-state')).toBe('complete');
  });

  it('says why a transfer failed', async () => {
    announce('failed-1', 2n);
    await settle();
    await act(async (): Promise<void> => { await fileTransferService.acceptTransfer('failed-1'); });
    const respond: { RespondFileTransfer: { request_id: string } } =
      sendRequest.mock.calls.at(-1)?.[0] as { RespondFileTransfer: { request_id: string } };
    render(<FileTransferBubble message={offerEntry('failed-1')} isOwn={false} />);

    act((): void => {
      eventEmitter.emit('websocket-message', {
        FileTransferTickNotification: {
          cid: BOB, peer_cid: ALICE, request_id: respond.RespondFileTransfer.request_id,
          status: { Fail: 'An unknown error occurred while receiving file' },
        },
      });
    });
    await settle();

    expect(screen.getByTestId('file-transfer-bubble').getAttribute('data-transfer-state')).toBe('error');
    expect(screen.getByText('Transfer failed: An unknown error occurred while receiving file')).toBeTruthy();
  });
});
