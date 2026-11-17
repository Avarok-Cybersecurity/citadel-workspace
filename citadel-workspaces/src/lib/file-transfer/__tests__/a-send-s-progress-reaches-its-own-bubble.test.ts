/**
 * A send's progress reaches its own bubble, and nothing else's.
 *
 * Live (Mac -> Windows, P2P): the receiver saved the file while the sender's
 * bubble stayed on "Sending... 0%". Sender-side ticks carried no id of their
 * own -- the agent stamped them with the session's TCP uuid -- so they were
 * placed by guessing: the OLDEST open outgoing transfer to that peer. A
 * "standard" offer that never resolved ('staged' for ever, see the accept path)
 * is exactly such a transfer, and it took the new send's ticks and completion.
 * And once a peer had stored a file here, the RE-VFS reception filed the same
 * TCP uuid as foreign, after which every send's ticks were dropped outright.
 *
 * The agent now names the SendFile on every sender tick, and names nothing on
 * a stream nobody here requested. These pin the browser's half.
 */
import { describe, it, expect } from 'vitest';
import { parseTickNotification, type TickCorrelation } from '../tick-events';
import { resolveTransferForProtocolEvent } from '../protocol-transfer-events';
import { FileTransferState } from '../state';
import type { FileTransferTickNotification } from '../protocol-types';
import type { FileTransfer } from '../types';

const ME: bigint = 7n;
const PEER: bigint = 42n;

function correlation(): TickCorrelation {
  return {
    objectIdToTransferId: new Map(),
    requestIdToTransferId: new Map(),
    requestIdToDownloadPath: new Map(),
    foreignRequestIds: new Set(),
  };
}

function tick(status: FileTransferTickNotification['status'], requestId: string | null | undefined): FileTransferTickNotification {
  return { cid: ME, peer_cid: PEER, status, request_id: requestId as string | null };
}

function outgoing(id: string, state: FileTransfer['state'], createdAt: number): FileTransfer {
  return {
    id, fileName: `${id}.png`, fileSize: 10, fileType: 'image/png', state,
    progress: 0, senderCid: ME.toString(), recipientCid: PEER.toString(),
    createdAt, updatedAt: createdAt, expiresAt: createdAt + 1_000_000, isIncoming: false,
  };
}

describe('sender-side ticks', () => {
  it('a tick that names its SendFile resolves to that transfer even after a RE-VFS reception', () => {
    const ctx: TickCorrelation = correlation();
    ctx.requestIdToTransferId.set('send-1', 'transfer-1');
    ctx.foreignRequestIds.add('revfs-reception');
    expect(parseTickNotification(tick({ TransferTick: [1, 2, 9] }, 'send-1'), ctx)).toMatchObject({
      kind: 'progress', direction: 'outgoing', transferId: 'transfer-1', percentage: 50,
    });
  });

  it.each([null, undefined])('a tick naming no request (%s) is no chat transfer and is dropped', (requestId) => {
    // WASM gives `undefined` for Rust's None; JSON gives null. Both mean "nobody asked".
    const ctx: TickCorrelation = correlation();
    expect(parseTickNotification(tick('TransferComplete', requestId), ctx)).toBeNull();
    expect(parseTickNotification(tick({ ReceptionTick: [1, 1, 1] }, requestId), ctx)).toBeNull();
  });
});

describe('the guess for a tick from an older agent', () => {
  it('never lands on a held send, which has no protocol stream to tick', () => {
    const state: FileTransferState = new FileTransferState();
    state.setTransfer(outgoing('held', 'queued', 1));
    state.setTransfer(outgoing('live-send', 'transferring', 2));
    const picked: FileTransfer | undefined = resolveTransferForProtocolEvent(state, {
      cid: ME, peerCid: PEER, direction: 'outgoing',
    });
    expect(picked?.id).toBe('live-send');
  });
});
