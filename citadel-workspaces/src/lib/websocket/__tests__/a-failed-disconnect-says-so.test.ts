/**
 * A disconnect that the service refuses has to fail here, promptly.
 *
 * `matchFailure` read `DisconnectFailure`, and nothing in the internal service
 * ever constructs that variant. The C2S disconnect handler is shared with the
 * peer path and answers BOTH with `PeerDisconnectFailure` — so "disconnect:
 * Server connection not found" arrived, matched nothing, and the caller sat out
 * the whole thirty-second budget before rejecting with a timeout that said
 * nothing about the reason. Above it, the UI's loading modal spun for those
 * thirty seconds over a decision the service had already made.
 */
import { describe, it, expect, vi } from 'vitest';
import { DisconnectOperations } from '../disconnect-operations';
import { eventEmitter } from '@/lib/event-emitter';

const CID: bigint = 4242n;
const REFUSAL: string = 'disconnect: Server connection not found';

function opsThatCapture(): {
  ops: DisconnectOperations;
  requestId: () => string | undefined;
} {
  let seen: string | undefined;
  const ops: DisconnectOperations = new DisconnectOperations({
    init: async (): Promise<void> => {},
    sendRequest: async (request: unknown): Promise<void> => {
      const body: { Disconnect?: { request_id: string } } = request as { Disconnect?: { request_id: string } };
      seen = body.Disconnect?.request_id;
    },
  });
  return { ops, requestId: (): string | undefined => seen };
}

describe('a refused disconnect', () => {
  it('rejects with the service reason, not a timeout', async (): Promise<void> => {
    const { ops, requestId } = opsThatCapture();
    const pending: Promise<void> = ops.disconnect(CID);

    // Let the request go out so its id can be echoed back.
    await vi.waitFor((): void => { expect(requestId()).toBeDefined(); });
    eventEmitter.emit('websocket-message', {
      PeerDisconnectFailure: { request_id: requestId(), cid: CID, message: REFUSAL },
    });

    await expect(pending).rejects.toThrow(REFUSAL);
  });

  it('still resolves on the success notification', async (): Promise<void> => {
    const { ops, requestId } = opsThatCapture();
    const pending: Promise<void> = ops.disconnect(CID);

    await vi.waitFor((): void => { expect(requestId()).toBeDefined(); });
    eventEmitter.emit('websocket-message', {
      DisconnectNotification: { request_id: requestId(), cid: CID },
    });

    await expect(pending).resolves.not.toThrow();
  });

  it('ignores a failure belonging to a different request', async (): Promise<void> => {
    // The fallback for a null request_id matches on CID, so a refusal for
    // somebody else's session must not resolve this one.
    const { ops, requestId } = opsThatCapture();
    const pending: Promise<void> = ops.disconnect(CID);

    await vi.waitFor((): void => { expect(requestId()).toBeDefined(); });
    eventEmitter.emit('websocket-message', {
      PeerDisconnectFailure: { request_id: null, cid: 9999n, message: 'not yours' },
    });
    eventEmitter.emit('websocket-message', {
      DisconnectNotification: { request_id: requestId(), cid: CID },
    });

    await expect(pending).resolves.not.toThrow();
  });
});
