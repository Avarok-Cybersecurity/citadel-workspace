/**
 * Two SendFile sites created their ack promise BESIDE the send instead of
 * wiring the send into it.
 *
 * `server-upload.ts` (the since-removed staging upload) and
 * `io.ts#sendFileViaProtocol` both did `const ack = awaitSendFileAck(id); await sendMessage(request); await
 * ack`. When the send threw, the caller rejected correctly — but the ack
 * promise was orphaned with its 'websocket-message' listener still attached
 * and its 30s timeout still armed; the timeout then rejected a promise nobody
 * was awaiting. Net effect per failed send: a leaked listener for 30 seconds
 * and an unhandled "SendFile request timed out" rejection long after the user
 * had already been shown the real error. The sibling request/response sites
 * (send-operations.ts, receive-operations.ts) wire `sendRequest(...).catch`
 * into the same promise; `awaitSendFileAck` now runs the send itself and does
 * the same.
 *
 * The observables here are the leak itself: the emitter's listener counts and
 * the armed-timer count must return to baseline the moment the send fails.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../tab-context', () => ({
  getSelectedUser: async (): Promise<{ selectedCid: bigint }> => ({ selectedCid: 7n }),
}));

const sendMessage: ReturnType<typeof vi.fn> = vi.fn();
vi.mock('../../websocket-service', () => ({
  websocketService: {
    sendMessage: (request: Record<string, unknown>): Promise<void> => sendMessage(request) as Promise<void>,
    sendRequest: async (): Promise<void> => undefined,
    sendP2PMessageReliable: async (): Promise<void> => undefined,
    // In-band signals open this session's messenger first; see in-band-signals.
    ensureMessengerOpen: async (): Promise<boolean> => false,
  },
}));

const { eventEmitter } = await import('../../event-emitter');
const { FileTransferIO } = await import('../io');
import type { FileTransfer } from '../types';

function chatTransfer(): FileTransfer {
  return {
    id: 'transfer-1', fileName: 'notes.md', fileSize: 4, fileType: 'text/markdown',
    state: 'pending', progress: 0,
    senderCid: '7', recipientCid: '42',
    createdAt: 0, updatedAt: 0, isIncoming: false,
  };
}

interface Baseline { message: number; disconnected: number; }

function listenerBaseline(): Baseline {
  return {
    message: eventEmitter.listenerCount('websocket-message'),
    disconnected: eventEmitter.listenerCount('websocket-disconnected'),
  };
}

beforeEach((): void => {
  vi.useFakeTimers();
  sendMessage.mockRejectedValue(new Error('socket send failed'));
});

afterEach((): void => {
  vi.useRealTimers();
  sendMessage.mockReset();
});

describe('when the SendFile frame itself fails to send', () => {
  it('the native-picker protocol send rejects with the send error and leaves no listener or timer behind', async () => {
    const io: InstanceType<typeof FileTransferIO> = new FileTransferIO();
    const before: Baseline = listenerBaseline();

    await expect(
      io.executeIntent({
        type: 'send-file-via-protocol',
        cid: '7', peerCid: '42', filePath: '/home/alice/report.pdf',
        transferId: 'transfer-1', transfer: chatTransfer(),
      }),
    ).rejects.toThrow(/socket send failed/);

    expect(listenerBaseline()).toEqual(before);
    expect(vi.getTimerCount()).toBe(0);
    io.dispose();
  });

  it('a send that succeeds still resolves on the service ack — failure wiring must not eat the success path', async () => {
    sendMessage.mockImplementation(async (request: Record<string, unknown>): Promise<void> => {
      const requestId: string = (request.SendFile as { request_id: string }).request_id;
      // The service's ack arrives after the send resolves, as on the wire.
      queueMicrotask((): void => {
        eventEmitter.emit('websocket-message', { SendFileRequestSuccess: { request_id: requestId } });
      });
    });

    const io: InstanceType<typeof FileTransferIO> = new FileTransferIO();
    await expect(
      io.executeIntent({
        type: 'send-file-via-protocol',
        cid: '7', peerCid: '42', filePath: '/home/alice/report.pdf',
        transferId: 'transfer-1', transfer: chatTransfer(),
      }),
    ).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    io.dispose();
  });
});
