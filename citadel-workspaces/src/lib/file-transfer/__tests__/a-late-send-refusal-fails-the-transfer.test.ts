/**
 * A refusal the agent sends AFTER it accepted a send still reaches the transfer.
 *
 * The agent answers SendFile twice under one request_id when the SDK refuses the object after
 * accepting the request: SendFileRequestSuccess, then SendFileRequestFailure (live, 2026-09-27:
 * "File transfer is not enabled for this p2p session. Both nodes must use a filesystem backend").
 * executeSendFile resolved on the first answer and stopped listening, so the refusal was dropped
 * and the sender's bubble read "Waiting for acceptance…" for ever.
 *
 * Real: FileTransferIO (the router), send-operations and the status handler. Mocked: the socket.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { eventEmitter } from '../../event-emitter';
import type { TransferStatusEvent } from '../io-router-types';

type Sent = { SendFile: { request_id: string } };
const sent: Sent[] = [];
vi.mock('../../websocket-service', () => ({
  websocketService: {
    sendRequest: async (request: unknown): Promise<void> => {
      sent.push(request as Sent);
      const { request_id } = (request as Sent).SendFile;
      queueMicrotask(() => eventEmitter.emit('websocket-message', { SendFileRequestSuccess: { cid: 7n, request_id } }));
    },
  },
}));

const { FileTransferIO } = await import('../io');

const REFUSAL: string = 'File transfer is not enabled for this p2p session. Both nodes must use a filesystem backend';

async function sendOne(io: InstanceType<typeof FileTransferIO>, transferId: string): Promise<string> {
  await io.sendFile({ source: '/tmp/a.bin', cid: 7n, peerCid: 42n, transferId,
    metadata: { fileName: 'a.bin', fileSize: 3, fileType: 'application/octet-stream' } });
  return sent[sent.length - 1].SendFile.request_id;
}

describe('a send the agent refuses after accepting it', () => {
  beforeEach(() => { sent.length = 0; });

  it('fails the transfer with the agent\'s reason', async () => {
    const io: InstanceType<typeof FileTransferIO> = new FileTransferIO();
    const statuses: Mock<(event: TransferStatusEvent) => void> = vi.fn();
    io.onStatusChange(statuses);
    const requestId: string = await sendOne(io, 'T1');

    eventEmitter.emit('websocket-message', { SendFileRequestFailure: { cid: 7n, message: REFUSAL, request_id: requestId } });

    expect(statuses).toHaveBeenCalledTimes(1);
    expect(statuses.mock.calls[0][0]).toMatchObject({ transferId: 'T1', success: false, accepted: false, message: REFUSAL });
    io.dispose();
  });

  it("ignores a refusal of someone else's request", async () => {
    const io: InstanceType<typeof FileTransferIO> = new FileTransferIO();
    const statuses: Mock<(event: TransferStatusEvent) => void> = vi.fn();
    io.onStatusChange(statuses);
    await sendOne(io, 'T2');

    eventEmitter.emit('websocket-message', { SendFileRequestFailure: { cid: 7n, message: REFUSAL, request_id: 'not-ours' } });

    expect(statuses).not.toHaveBeenCalled();
    io.dispose();
  });
});
