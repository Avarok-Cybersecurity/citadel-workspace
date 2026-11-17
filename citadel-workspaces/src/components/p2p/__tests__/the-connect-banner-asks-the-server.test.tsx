/**
 * The banner in a chat with someone you are not registered with: what it says, and that the
 * automatic request rests on the server's trust answer for THIS session and this peer.
 *
 * Two doubles, each an I/O boundary: the discovery hook (it owns the session lookup and the
 * PeerRegister send over the agent's socket) and the bound trust request (the workspace
 * server). The banner, the hook and the fail-closed check between them are the production code.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PeerTrust } from '@/lib/workspace-service/messaging-trust-operations';

const h: { trust: PeerTrust; registerWithPeer: ReturnType<typeof vi.fn>; checkPeer: ReturnType<typeof vi.fn> } = vi.hoisted(() => ({
  trust: { trusted: false, peerTrustsCaller: false },
  registerWithPeer: vi.fn(async (): Promise<boolean> => true),
  checkPeer: vi.fn(),
}));

vi.mock('../usePeerDiscovery', () => ({
  usePeerDiscovery: (): { currentCid: bigint; registerWithPeer: typeof h.registerWithPeer } => ({ currentCid: 7n, registerWithPeer: h.registerWithPeer }),
}));
vi.mock('@/lib/messaging-trust/messaging-trust-api', () => ({
  messagingTrustApi: {
    checkPeer: (username: string): Promise<PeerTrust> => { h.checkPeer(username); return Promise.resolve(h.trust); },
    sessionCid: (): bigint => 7n,
  },
}));

import { ConnectRequestBanner } from '../ConnectRequestBanner';

beforeEach(() => { h.registerWithPeer.mockClear(); h.checkPeer.mockClear(); });
afterEach(cleanup);

function banner(registered: boolean): void {
  render(<ConnectRequestBanner peerCid={42n} peerName="Bob" peerUsername="bob" registered={registered} />);
}

describe('the connect banner', () => {
  it('sends the request unprompted, and without a toast, when the server trusts the peer both ways', async () => {
    h.trust = { trusted: true, peerTrustsCaller: true };
    banner(false);
    await waitFor((): void => expect(h.registerWithPeer).toHaveBeenCalledWith('42', 'bob', false));
    expect(h.checkPeer).toHaveBeenCalledWith('bob');
    expect(screen.getByTestId('p2p-connect-banner').textContent).toContain('Connecting with Bob');
  });

  it('says it is waiting when the peer must accept', async () => {
    h.trust = { trusted: true, peerTrustsCaller: false };
    banner(false);
    await waitFor((): void => expect(screen.getByTestId('p2p-connect-banner').getAttribute('data-stage')).toBe('waiting'));
    expect(screen.getByTestId('p2p-connect-banner').textContent).toContain('Waiting for Bob to accept');
  });

  it('offers the request, and sends it only when asked, when the peer is not trusted', async () => {
    h.trust = { trusted: false, peerTrustsCaller: false };
    banner(false);
    await waitFor((): void => expect(h.checkPeer).toHaveBeenCalled());
    expect(screen.getByTestId('p2p-connect-banner').textContent).toContain("You aren't connected with Bob yet");
    expect(h.registerWithPeer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('p2p-connect-request'));
    await waitFor((): void => expect(h.registerWithPeer).toHaveBeenCalledWith('42', 'bob', true));
  });

  it('is absent, and asks nothing, once you are connected', async () => {
    h.trust = { trusted: true, peerTrustsCaller: true };
    banner(true);
    expect(screen.queryByTestId('p2p-connect-banner')).toBeNull();
    await Promise.resolve();
    expect(h.checkPeer).not.toHaveBeenCalled();
    expect(h.registerWithPeer).not.toHaveBeenCalled();
  });
});
