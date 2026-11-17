/**
 * A sender whose page reloaded before its agent confirmed a send sends it again
 * by itself, under the same transfer id (reload-recovery.ts). On the recipient's
 * side that is the same transfer: not a second record, not a second question,
 * and an offer already accepted stays accepted -- its new stream is accepted
 * without asking.
 *
 * Driven through the real service, router and correlator. Mocked: the socket to
 * the agent and the tab's session lookup, as in a-fast-reception-stays-complete.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/tab-context', () => ({
  getSelectedUser: async (): Promise<{ selectedCid: bigint }> => ({ selectedCid: 7n }),
}));

const sendRequest: ReturnType<typeof vi.fn> = vi.fn(async (_request: unknown): Promise<void> => undefined);
vi.mock('@/lib/websocket-service', () => ({
  websocketService: {
    sendRequest: (r: unknown): Promise<void> => sendRequest(r),
    sendP2PMessageReliable: async (): Promise<void> => undefined,
    ensureMessengerOpen: async (): Promise<boolean> => false,
    canSendRequests: (): boolean => false,
  },
}));

import { eventEmitter } from '@/lib/event-emitter';
import { fileTransferService } from '../service';
import { FILE_TRANSFER_EVENTS } from '../events';
import { MessagingLayerType } from '@/types/messaging-layer';
import type { FileTransfer } from '../types';
import type { VirtualObjectMetadata } from '../protocol-types';

const ME: bigint = 7n;
const PEER: bigint = 42n;
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function offer(transferId: string, objectId: bigint): void {
  const name: string = `${transferId}.jpg`;
  eventEmitter.emit('p2p:file-transfer-message', {
    layer: {
      type: MessagingLayerType.FileTransferRequest, transfer_id: transferId, file_name: name, file_size: 165_000,
      file_type: 'image/jpeg', timestamp: Date.now(), expiry_timestamp: Date.now() + 60_000,
    },
    senderCid: PEER.toString(), recipientCid: ME.toString(),
  });
  const metadata: VirtualObjectMetadata = {
    name, date_created: '', author: 'peer', plaintext_length: 165_000, group_count: 1,
    object_id: objectId, cid: PEER, transfer_type: 'FileTransfer',
  } as VirtualObjectMetadata;
  eventEmitter.emit('websocket-message', { FileTransferRequestNotification: { cid: ME, peer_cid: PEER, metadata, request_id: null } });
}

function answers(): Array<{ object_id: bigint; accept: boolean }> {
  return sendRequest.mock.calls
    .map((call: unknown[]) => (call[0] as { RespondFileTransfer?: { object_id: bigint; accept: boolean } }).RespondFileTransfer)
    .filter((r): r is { object_id: bigint; accept: boolean } => r !== undefined);
}

const asked: string[] = [];
eventEmitter.on(FILE_TRANSFER_EVENTS.REQUEST_RECEIVED, (t: FileTransfer) => { asked.push(t.id); });

beforeEach(() => { sendRequest.mockClear(); });

describe('an offer sent again under the same transfer id', () => {
  it('is not asked about twice while it is still unanswered, and accepting answers the new one', async () => {
    offer('again-1', 100n);
    await settle();
    offer('again-1', 101n);
    await settle();
    expect(asked.filter((id: string) => id === 'again-1')).toHaveLength(1);
    expect(fileTransferService.getTransfer('again-1')?.state).toBe('pending');

    await fileTransferService.acceptTransfer('again-1');
    expect(answers()).toEqual([expect.objectContaining({ object_id: 101n, accept: true })]);
  });

  it('stays accepted: its new stream is accepted without asking', async () => {
    offer('again-2', 200n);
    await settle();
    await fileTransferService.acceptTransfer('again-2');
    expect(fileTransferService.getTransfer('again-2')?.state).toBe('transferring');
    sendRequest.mockClear();

    offer('again-2', 201n);
    await settle();
    await settle();
    expect(asked.filter((id: string) => id === 'again-2')).toHaveLength(1);
    expect(answers()).toEqual([expect.objectContaining({ object_id: 201n, accept: true })]);
    expect(fileTransferService.getTransfer('again-2')?.state).toBe('transferring');
  });

  it('is left alone once the transfer is over', async () => {
    offer('again-3', 300n);
    await settle();
    await fileTransferService.declineTransfer('again-3');
    sendRequest.mockClear();

    offer('again-3', 301n);
    await settle();
    expect(answers()).toEqual([]);
    expect(fileTransferService.getTransfer('again-3')?.state).toBe('declined');
  });
});
