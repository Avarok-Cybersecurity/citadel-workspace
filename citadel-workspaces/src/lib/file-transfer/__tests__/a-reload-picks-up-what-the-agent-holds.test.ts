/**
 * A page reload does not end a transfer the agent is still running.
 *
 * Owner report (2026-11-15): sending a 165 KB jpeg, the sender's own bubble
 * read "Transfer failed: Interrupted when the page reloaded. Ask them to send it
 * again." The agent is a separate process and keeps the session across a
 * reload: the offer it sent was still waiting for its answer, and its ticks name
 * the SendFile request (tick_updater.rs). The page restored every moving
 * transfer as failed (restore-transfer.ts) because it had not kept that name.
 *
 * Driven through the real service, router, parser and persistence: the records
 * are written where the previous page wrote them, then the service module loads
 * as a reloaded page loads it. Mocked: the socket to the agent and the tab's
 * session lookup, as in a-fast-reception-stays-complete.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';

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
import { MessagingLayerType } from '@/types/messaging-layer';
import { scopedTransfersKey } from '../settings-key';
import { transferView } from '../transfer-view';
import type { FileTransfer } from '../types';
import type { FileTransferService } from '../service';

const ME: bigint = 7n;
const PEER: bigint = 42n;
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const frame = (message: Record<string, unknown>): void => { eventEmitter.emit('websocket-message', message); };
const tick = (requestId: string, status: unknown): void =>
  frame({ FileTransferTickNotification: { cid: ME, peer_cid: PEER, request_id: requestId, status } });
const fromPeer = (layer: Record<string, unknown>): void =>
  eventEmitter.emit('p2p:file-transfer-message', { layer: { ...layer, timestamp: Date.now() }, senderCid: PEER.toString(), recipientCid: ME.toString() });

function record(id: string, over: Partial<FileTransfer>): Partial<FileTransfer> {
  const outgoing: boolean = over.isIncoming !== true;
  return {
    id, fileName: `${id}.jpg`, fileSize: 165_000, fileType: 'image/jpeg', progress: 40,
    senderCid: (outgoing ? ME : PEER).toString(), recipientCid: (outgoing ? PEER : ME).toString(),
    createdAt: 1, updatedAt: 2, isIncoming: false, ...over,
  };
}

let service: FileTransferService;

beforeAll(async () => {
  service = (await import('../service')).fileTransferService;
  await service.initialize();
  // What the page before the reload persisted for this account, read back the
  // way a reloaded page reads it: once the tab knows the account.
  const before: Record<string, Partial<FileTransfer>> = {
    'awaiting-answer': record('awaiting-answer', { state: 'pending', tickRequestId: 'req-send-1' }),
    // Older than the transfers whose ticks follow, so a tick the page could
    // not place by its request id would land on these (protocol-transfer-events
    // falls back to the oldest live transfer with that peer): placed by id, or wrong.
    'sending': record('sending', { state: 'transferring', tickRequestId: 'req-send-2', createdAt: 0 }),
    'receiving': record('receiving', { state: 'transferring', isIncoming: true, tickRequestId: 'req-recv-1', downloadPath: '/data/receiving.jpg' }),
    'unanswered': record('unanswered', { state: 'pending', isIncoming: true, objectId: '555', createdAt: 0 }),
  };
  localStorage.setItem(scopedTransfersKey(), JSON.stringify(before));
  eventEmitter.emit('instance:cid-changed', { cid: ME });
  await settle();
});

describe('a sender whose page reloaded', () => {
  it('still waits for the answer to its offer, and follows the transfer when it starts', async () => {
    const restored: FileTransfer | undefined = service.getTransfer('awaiting-answer');
    expect(restored?.state).toBe('pending');
    expect(transferView({}, restored, false, 'sent').reason).toBeUndefined();

    fromPeer({ type: MessagingLayerType.FileTransferResponse, transfer_id: 'awaiting-answer', accepted: true });
    tick('req-send-1', { TransferTick: [1, 2, 0] });
    await settle();
    expect(service.getTransfer('awaiting-answer')).toMatchObject({ state: 'transferring', progress: 50 });

    tick('req-send-1', 'TransferComplete');
    await settle();
    expect(service.getTransfer('awaiting-answer')?.state).toBe('complete');
    // Followed, not sent again.
    expect(sendRequest.mock.calls.some((call: unknown[]) => 'SendFile' in (call[0] as object))).toBe(false);
  });

  it('says it is resuming a moving send, and finishes on the receiver\'s word when its last tick went to no page', async () => {
    const restored: FileTransfer | undefined = service.getTransfer('sending');
    expect(restored?.state).toBe('transferring');
    expect(transferView({}, restored, false, 'sent').resuming).toBe(true);

    fromPeer({ type: MessagingLayerType.FileTransferComplete, transfer_id: 'sending', success: true });
    await settle();
    expect(service.getTransfer('sending')?.state).toBe('complete');
    expect(transferView({}, service.getTransfer('sending'), false, 'sent').resuming).toBe(false);
  });
});

describe('a recipient whose page reloaded', () => {
  it('follows the reception the agent kept running, and keeps where it is saved', async () => {
    expect(service.getTransfer('receiving')).toMatchObject({ state: 'transferring', resuming: true });

    tick('req-recv-1', { ReceptionTick: [3, 4, 0] });
    await settle();
    expect(service.getTransfer('receiving')).toMatchObject({ progress: 75, resuming: false });

    tick('req-recv-1', 'ReceptionComplete');
    await settle();
    expect(service.getTransfer('receiving')).toMatchObject({ state: 'complete', downloadPath: '/data/receiving.jpg' });
  });

  it('can still accept an offer that arrived before the reload', async () => {
    expect(service.getTransfer('unanswered')?.state).toBe('pending');
    await service.acceptTransfer('unanswered');
    const answers: Array<{ object_id: bigint; accept: boolean }> = sendRequest.mock.calls
      .map((call: unknown[]) => (call[0] as { RespondFileTransfer?: { object_id: bigint; accept: boolean } }).RespondFileTransfer)
      .filter((r): r is { object_id: bigint; accept: boolean } => r !== undefined);
    expect(answers).toEqual([expect.objectContaining({ object_id: 555n, accept: true })]);
  });
});
