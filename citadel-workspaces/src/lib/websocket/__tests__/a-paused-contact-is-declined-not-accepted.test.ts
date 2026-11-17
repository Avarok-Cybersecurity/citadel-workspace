/**
 * Declining a PeerConnect sends `accept: false`, and a refusal answers it.
 *
 * A paused contact's auto-connect dials us every few seconds. Ignoring the
 * notification leaves their PeerConnect hanging for the SDK's full timeout on
 * every attempt; the agent already supports a refusal (`accept: false` on
 * PeerConnectAccept), which ends each attempt at once.
 *
 * The inverse of `a-declined-connection-is-not-an-acceptance`: there a refusal
 * must not settle an ACCEPT; here it is exactly what settles a DECLINE, and an
 * acceptance must not.
 */
import { describe, it, expect, vi } from 'vitest';
import type { ChatSecurityLevel } from '@/lib/p2p/chat-advanced-settings';
import { P2POperations } from '../p2p-operations';
import { eventEmitter } from '@/lib/event-emitter';

const CID: bigint = 4242n;
const PEER: bigint = 8484n;

interface SentAccept { request_id: string; accept: boolean; cid: bigint; peer_cid: bigint }

function opsThatCapture(): { ops: P2POperations; sent: () => SentAccept | undefined } {
  let seen: SentAccept | undefined;
  const ops: P2POperations = new P2POperations({
    init: async (): Promise<void> => {},
    sendMessage: async (message: unknown): Promise<void> => {
      const body: { PeerConnectAccept?: SentAccept } = message as { PeerConnectAccept?: SentAccept };
      if (body.PeerConnectAccept) seen = body.PeerConnectAccept;
    },
    isLeader: (): boolean => true,
    // Not under test here: the chat level only shapes the offer, not whether a pause declines it.
    securityFor: async (): Promise<ChatSecurityLevel> => 'Standard',
    turnFor: async (): Promise<null> => null,
  });
  return { ops, sent: (): SentAccept | undefined => seen };
}

async function settlesWithin(pending: Promise<void>, ms: number): Promise<boolean> {
  return Promise.race([
    pending.then((): boolean => true),
    new Promise<boolean>((resolve) => setTimeout((): void => resolve(false), ms)),
  ]);
}

describe('declining an incoming connection', () => {
  it('sends a refusal for that session and peer', async (): Promise<void> => {
    const { ops, sent } = opsThatCapture();
    void ops.declinePeerConnect(CID, PEER, null);
    await vi.waitFor((): void => { expect(sent()).toBeDefined(); });
    expect(sent()).toMatchObject({ cid: CID, peer_cid: PEER, accept: false });
  });

  it('is settled by the refusal being delivered', async (): Promise<void> => {
    const { ops, sent } = opsThatCapture();
    const pending: Promise<void> = ops.declinePeerConnect(CID, PEER, null);
    await vi.waitFor((): void => { expect(sent()).toBeDefined(); });
    eventEmitter.emit('websocket-message', {
      PeerConnectAcceptSuccess: { request_id: sent()!.request_id, cid: CID, peer_cid: PEER, accept: false },
    });
    expect(await settlesWithin(pending, 150)).toBe(true);
  });

  it('is not settled by an answer that says accepted', async (): Promise<void> => {
    const { ops, sent } = opsThatCapture();
    const pending: Promise<void> = ops.declinePeerConnect(CID, PEER, null);
    await vi.waitFor((): void => { expect(sent()).toBeDefined(); });
    eventEmitter.emit('websocket-message', {
      PeerConnectAcceptSuccess: { request_id: sent()!.request_id, cid: CID, peer_cid: PEER, accept: true },
    });
    expect(await settlesWithin(pending, 150)).toBe(false);
  });

  it('leaves accepting as it was: accept is still true', async (): Promise<void> => {
    const { ops, sent } = opsThatCapture();
    void ops.acceptPeerConnect(CID, PEER, null);
    await vi.waitFor((): void => { expect(sent()).toBeDefined(); });
    expect(sent()!.accept).toBe(true);
  });
});
