/**
 * A file this browser asked a peer for is accepted when it arrives, and the
 * request settles with where it was saved.
 *
 * In shared peer storage only the uploader can open a file, so downloading the
 * other person's file means asking them to send it (lib/revfs/request-share.ts).
 * Their offer must not stop at an Accept prompt the user never expects -- they
 * already clicked Download -- and an offer nobody asked for must still prompt.
 *
 * Driven through the real service, router and parser. Mocked: the socket to the
 * agent and the tab's session lookup, as in a-fast-reception-stays-complete.
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
import { requestedShares } from '../requested-shares';
import { MessagingLayerType } from '@/types/messaging-layer';
import type { FileTransfer } from '../types';
import type { VirtualObjectMetadata } from '../protocol-types';

const BOB: bigint = 7n;
const ALICE: bigint = 42n;
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const frame = (message: Record<string, unknown>): void => { eventEmitter.emit('websocket-message', message); };

function offer(transferId: string, objectId: bigint, name: string): void {
  const metadata: VirtualObjectMetadata = {
    name, date_created: '', author: 'alice', plaintext_length: 1400, group_count: 1,
    object_id: objectId, cid: ALICE, transfer_type: 'FileTransfer',
  } as VirtualObjectMetadata;
  eventEmitter.emit('p2p:file-transfer-message', {
    layer: {
      type: MessagingLayerType.FileTransferRequest, transfer_id: transferId, file_name: name, file_size: 1400,
      file_type: 'image/png', transfer_mode: 'p2p', timestamp: Date.now(), expiry_timestamp: Date.now() + 60_000,
    },
    senderCid: ALICE.toString(), recipientCid: BOB.toString(),
  });
  frame({ FileTransferRequestNotification: { cid: BOB, peer_cid: ALICE, metadata, request_id: null } });
}

function responses(): Array<{ RespondFileTransfer: { request_id: string; accept: boolean } }> {
  return sendRequest.mock.calls
    .map((call: unknown[]) => call[0] as Record<string, unknown>)
    .filter((r: Record<string, unknown>) => 'RespondFileTransfer' in r) as Array<{ RespondFileTransfer: { request_id: string; accept: boolean } }>;
}

beforeEach(() => { sendRequest.mockClear(); });

describe('a share this browser asked for', () => {
  it('is accepted without a prompt and settles with the saved path', async () => {
    const delivered: Promise<FileTransfer> = requestedShares.expect('share-1');
    offer('share-1', 31337n, 'atlas.png');
    await settle();
    await settle();

    expect(responses()).toHaveLength(1);
    const requestId: string = responses()[0].RespondFileTransfer.request_id;
    expect(responses()[0].RespondFileTransfer.accept).toBe(true);

    const path: string = '/data/transfers/42/atlas.png';
    frame({ FileTransferTickNotification: { cid: BOB, peer_cid: ALICE, request_id: requestId, status: { ReceptionBeginning: [path, { transfer_type: 'FileTransfer', object_id: 31337n, plaintext_length: 1400 }] } } });
    frame({ FileTransferTickNotification: { cid: BOB, peer_cid: ALICE, request_id: requestId, status: 'ReceptionComplete' } });
    await expect(delivered).resolves.toMatchObject({ id: 'share-1', downloadPath: path });
  });

  it('while an offer nobody asked for still waits for the user', async () => {
    offer('unasked-1', 31338n, 'other.png');
    await settle();
    await settle();
    expect(responses()).toHaveLength(0);
    expect(fileTransferService.getTransfer('unasked-1')?.state).toBe('pending');
  });
});
