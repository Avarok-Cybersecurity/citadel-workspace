/**
 * A refusal must not be read as an established connection.
 *
 * `PeerConnectAccept` answers BOTH outcomes with `PeerConnectAcceptSuccess`,
 * because both are successes from the service's side: the answer was
 * delivered. The type name was the whole message, so matching on `request_id`
 * alone treated "your refusal was sent" as "they accepted".
 *
 * That exact confusion, on `PeerRegisterSuccess`, was live: declining a
 * registration ran the acceptance path, marked the declined peer registered,
 * and had auto-connect open a connection to the person just refused.
 *
 * The response now carries `accept`, and this pins both directions — a rule
 * that refused everything would satisfy the decline case on its own.
 */
import { describe, it, expect, vi } from 'vitest';
import { P2POperations } from '../p2p-operations';
import { eventEmitter } from '@/lib/event-emitter';

const CID: bigint = 4242n;
const PEER: bigint = 8484n;

function opsThatCapture(): {
  ops: P2POperations;
  requestId: () => string | undefined;
} {
  let seen: string | undefined;
  const ops: P2POperations = new P2POperations({
    init: async (): Promise<void> => {},
    sendMessage: async (message: unknown): Promise<void> => {
      const body: { PeerConnectAccept?: { request_id: string } } =
        message as { PeerConnectAccept?: { request_id: string } };
      if (body.PeerConnectAccept) seen = body.PeerConnectAccept.request_id;
    },
    isLeader: (): boolean => true,
    // Accepting never fetches relay servers; a PeerConnect-only port.
    turnFor: async (): Promise<null> => null,
    // Accepting never reads the chat level either; only PeerConnect does.
    securityFor: async (): Promise<'Standard'> => 'Standard',
  });
  return { ops, requestId: (): string | undefined => seen };
}

describe('PeerConnectAcceptSuccess carrying the outcome', () => {
  it('does not treat a declined answer as an accepted connection', async (): Promise<void> => {
    const { ops, requestId } = opsThatCapture();
    const pending: Promise<void> = ops.acceptPeerConnect(CID, PEER, null);

    await vi.waitFor((): void => { expect(requestId()).toBeDefined(); });
    const matched: string | undefined = requestId();

    eventEmitter.emit('websocket-message', {
      PeerConnectAcceptSuccess: { request_id: matched, cid: CID, peer_cid: PEER, accept: false },
    });

    // The refusal must not satisfy the wait. The call is soft — it falls
    // through on timeout rather than throwing — so what is asserted is that the
    // decline did NOT settle it as a success.
    const settledEarly: boolean = await Promise.race([
      pending.then((): boolean => true),
      new Promise<boolean>((resolve) => setTimeout((): void => resolve(false), 150)),
    ]);
    expect(settledEarly).toBe(false);
  });

  it('still accepts when the answer was an acceptance', async (): Promise<void> => {
    const { ops, requestId } = opsThatCapture();
    const pending: Promise<void> = ops.acceptPeerConnect(CID, PEER, null);

    await vi.waitFor((): void => { expect(requestId()).toBeDefined(); });
    eventEmitter.emit('websocket-message', {
      PeerConnectAcceptSuccess: { request_id: requestId(), cid: CID, peer_cid: PEER, accept: true },
    });

    await expect(pending).resolves.not.toThrow();
  });
});
