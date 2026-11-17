/**
 * The wiring of held sends: a peer's channel coming up releases what was held
 * for them, and a held send that ends another way drops its kept File.
 * Real: the event bus, the port's in-memory store (IndexedDB is absent under
 * jsdom, so the port keeps the File in memory -- its documented fallback).
 */
import { describe, it, expect, vi } from 'vitest';
import { eventEmitter } from '../../event-emitter';
import { sendQueuePort, wireSendQueue } from '../send-queue-io';
import { FileTransferState } from '../state';
import { FILE_TRANSFER_EVENTS } from '../events';
import type { HoldDeps } from '../send-queue-hold';
import type { FileTransfer } from '../types';

function held(id: string): FileTransfer {
  return {
    id, fileName: 'a.txt', fileSize: 3, fileType: 'text/plain', state: 'queued', progress: 0,
    senderCid: '7', recipientCid: '42', createdAt: 1, updatedAt: 1, isIncoming: false, waitingFor: 'Alexi',
  };
}

describe('held sends, wired', () => {
  it('are released when the peer\'s channel comes up', async () => {
    const state: FileTransferState = new FileTransferState();
    const executeIntent: ReturnType<typeof vi.fn> = vi.fn(async (): Promise<void> => undefined);
    const deps: HoldDeps = {
      state, io: { executeIntent } as unknown as HoldDeps['io'], queue: sendQueuePort,
      emitStateChange: (): void => undefined, saveTransfer: async (): Promise<void> => undefined,
    };
    wireSendQueue(deps, async (): Promise<bigint> => 7n);
    state.setTransfer(held('h1'));
    await sendQueuePort.hold('h1', new File(['abc'], 'a.txt'));

    eventEmitter.emit('p2p:channel-ready', { peerCid: 42n });
    await vi.waitFor(() => expect(executeIntent).toHaveBeenCalledWith(expect.objectContaining({ type: 'send-transfer-request', offerAlreadyShown: true })));
    // Still kept: it is dropped when the transfer ends (the next case), so a
    // reload before the agent confirms the send can send it again.
    expect(await sendQueuePort.take('h1')).toBeDefined();
  });

  it('drop the kept File when the send ends another way (expired, cancelled)', async () => {
    await sendQueuePort.hold('h2', new File(['x'], 'b.txt'));
    expect(await sendQueuePort.take('h2')).toBeDefined();
    eventEmitter.emit(FILE_TRANSFER_EVENTS.STATE_CHANGED, { ...held('h2'), state: 'expired' });
    await vi.waitFor(async () => expect(await sendQueuePort.take('h2')).toBeUndefined());
  });
});
