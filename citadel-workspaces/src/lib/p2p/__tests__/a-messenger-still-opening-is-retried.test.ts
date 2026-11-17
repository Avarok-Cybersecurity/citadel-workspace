/**
 * A send that races a concurrent messenger open must not fail the user.
 *
 * `ensureMessengerOpen` returns `false` for two states — "already open" and
 * "being opened by another task" — and only one is ready. The send path awaited
 * it, discarded the answer and sent immediately, so a send racing an open came
 * back "No messaging handle found for local CID" and `peer-failure-detail`
 * showed that to the user.
 *
 * Both directions are pinned. A retry that fired on every error would hide real
 * failures and double every latency, so the unrelated-error case is asserted
 * beside the retried one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const ensureMessengerOpen: ReturnType<typeof vi.fn> = vi.fn(async (): Promise<boolean> => false);
const sendP2PMessageReliable: ReturnType<typeof vi.fn> = vi.fn(async (): Promise<void> => {});

vi.mock('@/lib/websocket-service', () => ({
  websocketService: {
    ensureMessengerOpen: (...a: unknown[]): Promise<boolean> => ensureMessengerOpen(...(a as [])),
    sendP2PMessageReliable: (...a: unknown[]): Promise<void> => sendP2PMessageReliable(...(a as [])),
  },
}));

import { sendRawBytes } from '../message-send-operations';

const CID: bigint = 11n;
const PEER: bigint = 22n;
const config: never = { getCurrentCid: async (): Promise<bigint> => CID } as never;

describe('a send racing a messenger that is still opening', () => {
  beforeEach((): void => {
    ensureMessengerOpen.mockClear();
    sendP2PMessageReliable.mockClear();
  });

  it('retries once and succeeds', async (): Promise<void> => {
    let attempt: number = 0;
    sendP2PMessageReliable.mockImplementation(async (): Promise<void> => {
      attempt += 1;
      if (attempt === 1) {
        throw new Error('No messaging handle found for local CID: 11. Call open_p2p_connection first.');
      }
    });

    await expect(sendRawBytes(config, PEER, new Uint8Array([1]))).resolves.not.toThrow();
    expect(attempt).toBe(2);
    // The second attempt must re-ask, not assume the handle appeared.
    expect(ensureMessengerOpen).toHaveBeenCalledTimes(2);
  });

  it('does not retry an unrelated failure', async (): Promise<void> => {
    let attempt: number = 0;
    sendP2PMessageReliable.mockImplementation(async (): Promise<void> => {
      attempt += 1;
      throw new Error('peer refused the message');
    });

    await expect(sendRawBytes(config, PEER, new Uint8Array([1]))).rejects.toThrow('peer refused');
    expect(attempt).toBe(1);
  });

  it('gives up after the one retry rather than looping', async (): Promise<void> => {
    let attempt: number = 0;
    sendP2PMessageReliable.mockImplementation(async (): Promise<void> => {
      attempt += 1;
      throw new Error('No messaging handle found for local CID: 11.');
    });

    await expect(sendRawBytes(config, PEER, new Uint8Array([1]))).rejects.toThrow('No messaging handle');
    expect(attempt).toBe(2);
  });
});
