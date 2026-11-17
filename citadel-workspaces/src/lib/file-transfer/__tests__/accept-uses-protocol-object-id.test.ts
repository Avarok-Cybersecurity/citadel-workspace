/**
 * Accepting an incoming transfer must name the PROTOCOL's object_id.
 *
 * A transfer arrives as two events with two different names for it: the bytes
 * come over SendFile carrying a numeric `object_id`, and the bubble comes as a
 * P2P message carrying a `crypto.randomUUID()`. Accept goes back over the
 * protocol, so it has to name the object_id.
 *
 * It passed the UUID through to `BigInt(params.protocolId)`, which throws
 * SyntaxError synchronously while the request literal is built — before
 * anything is sent. `RespondFileTransfer` was therefore never issued for ANY
 * incoming transfer: the offer was never accepted and the bytes never landed.
 *
 * This test drives the REAL FileTransferIO and mocks only the socket. The
 * existing accept test mocks `io` wholesale, which is exactly why this survived
 * — the mock stood precisely where the defect was.
 */
import { describe, it, expect, vi, beforeEach   } from 'vitest';

type SentRequest = {
  RespondFileTransfer: { object_id: bigint; accept: boolean; cid: bigint };
};

// The accept now names the LOCAL session, which the router reads from the tab
// selection (IndexedDB). Mocked here rather than left to fail, because the CID
// is the second half of what this file is about: see the cid-0 test below.
vi.mock('../../tab-context', () => ({
  getSelectedUser: async (): Promise<{ selectedCid: bigint; }> => ({ selectedCid: 7n }),
}));
const sendRequest: ReturnType<typeof vi.fn> = vi.fn(async (_request: unknown): Promise<void> => undefined);
// Accepting also sends an in-band response signal to the SENDER, whose UI
// otherwise learns of a decline not at all — the SDK gives a declined sender no
// notification whatsoever. Mocked so this file keeps testing the protocol half
// it is about; `in-band-signals` has its own tests.
const sendP2PMessageReliable: ReturnType<typeof vi.fn> = vi.fn(async (): Promise<void> => undefined);
vi.mock('@/lib/websocket-service', () => ({
  websocketService: {
    sendRequest: (r: unknown): Promise<void> => sendRequest(r),
    sendP2PMessageReliable: (): Promise<void> => sendP2PMessageReliable(),
    // In-band signals open this session's messenger first; see in-band-signals.
    ensureMessengerOpen: async (): Promise<boolean> => false,
  },
}));

import { FileTransferIO } from '../io';
import { TIMEOUT } from '../../timeout-constants';

const UUID: "6f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8" = '6f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8';
const OBJECT_ID: string = '90210';

/** Reach the accept path exactly as the lifecycle does. */
async function accept(io: FileTransferIO, transferId: string): Promise<void> {
  await io.executeIntent({
    type: 'send-response',
    transferId,
    targetCid: '42',
    accepted: true,
  });
}

describe('accepting a transfer', () => {
  beforeEach(() => sendRequest.mockClear());

  it('sends the protocol object_id, not the announcement UUID', async () => {
    const io: FileTransferIO = new FileTransferIO();
    io.registerTransferMapping(UUID, OBJECT_ID);

    await accept(io, UUID);

    expect(sendRequest).toHaveBeenCalledTimes(1);
    const sent: SentRequest = sendRequest.mock.calls[0]?.[0] as SentRequest;
    expect(sent.RespondFileTransfer.object_id).toBe(BigInt(OBJECT_ID));
    expect(sent.RespondFileTransfer.accept).toBe(true);
  });

  // Found live between two Macs (2026-09-27): for a large file the bubble arrives seconds before
  // the protocol offer (the sender announces, then stages the bytes), so an Accept pressed at once
  // was refused with "not announced over the protocol yet" -- and nothing tried again when the
  // halves joined a moment later. The accept now waits for the join, for as long as the sender's
  // own SendFile may take (TIMEOUT.FILE_SEND_MS).
  it('an accept pressed before the protocol offer is sent once the two halves join', async () => {
    vi.useFakeTimers();
    try {
      const io: FileTransferIO = new FileTransferIO();
      const accepted: Promise<void> = accept(io, UUID);
      await vi.advanceTimersByTimeAsync(3000);
      expect(sendRequest).not.toHaveBeenCalled();

      io.registerTransferMapping(UUID, OBJECT_ID);
      await accepted;

      expect(sendRequest).toHaveBeenCalledTimes(1);
      const sent: SentRequest = sendRequest.mock.calls[0]?.[0] as SentRequest;
      expect(sent.RespondFileTransfer.object_id).toBe(BigInt(OBJECT_ID));
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses with a readable message when the protocol offer never comes', async () => {
    vi.useFakeTimers();
    try {
      const io: FileTransferIO = new FileTransferIO();
      const accepted: Promise<void> = accept(io, UUID);
      const refusal: Promise<unknown> = expect(accepted).rejects.toThrow(/not been announced over the protocol/);
      await vi.advanceTimersByTimeAsync(TIMEOUT.FILE_SEND_MS + 1);
      await refusal;
      // The point of the guard: nothing is sent, and the failure is not a raw
      // BigInt parse error the user cannot act on.
      expect(sendRequest).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the accept it sends', () => {
  it('names the local session, not cid 0', async () => {
    // `cid: BigInt(0)` was there with the comment "Not used for message-based".
    // The internal service looks the connection up by exactly this field --
    // `server_connection_map.get_mut(&cid)` -- and nothing is filed under 0, so
    // every accept and decline came back "Connection not found". The send was
    // fire-and-forget, so nothing noticed: the recipient's bubble sat at
    // "Downloading... 0%" and the sender's at "Waiting for acceptance" for
    // ever, and no chat transfer ever moved a byte.
    sendRequest.mockClear();
    const io: FileTransferIO = new FileTransferIO();
    io.registerTransferMapping(UUID, OBJECT_ID);

    await accept(io, UUID);

    const sent: SentRequest = sendRequest.mock.calls[0][0] as SentRequest;
    expect(sent.RespondFileTransfer.cid).not.toBe(0n);
    expect(sent.RespondFileTransfer.cid).toBe(7n);
  });
});
