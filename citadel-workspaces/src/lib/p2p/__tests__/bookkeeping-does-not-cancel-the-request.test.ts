/**
 * A refused local write must not stop the peer request going out.
 *
 * `sendPeerRegistration` records the outgoing request before sending it, so a
 * failure notification arriving early can be correlated. But `addOutgoingRequest`
 * writes the WHOLE outgoing list, and the store refuses that write when its key
 * was never successfully read — correctly, since writing an in-memory list over
 * an unread key erases requests it does not know about.
 *
 * That refusal is a throw, and it was awaited before the send. So a storage read
 * that failed at startup meant the `PeerRegister` was never sent at all. Measured
 * on the live deployment with two real users: the peer's agent logged no
 * `[PeerRegister]`, the browser sent no frame but its own `GetSessions` polls,
 * and the sender was told
 *
 *   Request Failed — Refusing to write outgoing: '…' was never successfully read
 *
 * Losing the record costs the automatic resend for that request. Not sending it
 * costs the request.
 */
import { describe, it, expect, vi } from 'vitest';

const sent: Record<string, unknown>[] = [];
const addOutgoing: ReturnType<typeof vi.fn> = vi.fn();

vi.mock('@/lib/peer-registration-store', (): Record<string, unknown> => ({
  peerRegistrationStore: { addOutgoingRequest: (r: unknown): Promise<void> => addOutgoing(r) },
}));
vi.mock('@/lib/websocket-service', (): Record<string, unknown> => ({
  websocketService: {
    sendMessage: (m: Record<string, unknown>): Promise<void> => { sent.push(m); return Promise.resolve(); },
  },
}));
vi.mock('@/lib/security-utils', (): Record<string, unknown> => ({
  getDefaultSecuritySettings: (): Record<string, unknown> => ({}),
}));

import { sendPeerRegistration } from '../send-peer-registration';

describe('sending a peer registration', () => {
  it('sends even when the outgoing record cannot be written', async () => {
    sent.length = 0;
    addOutgoing.mockRejectedValueOnce(
      new Error("Refusing to write outgoing: 'outgoing_peer_requests_1' was never successfully read"),
    );

    await expect(sendPeerRegistration(1n, 2n, 'bob')).resolves.toBeTruthy();

    expect(sent).toHaveLength(1);
    expect(Object.keys(sent[0])).toEqual(['PeerRegister']);
  });

  it('still sends on the ordinary path', async () => {
    // Discrimination control: an implementation that sent only in the failure
    // branch would satisfy the test above.
    sent.length = 0;
    addOutgoing.mockResolvedValueOnce(undefined);

    await sendPeerRegistration(1n, 2n, 'bob');

    expect(sent).toHaveLength(1);
  });

  it('records the request when it can', async () => {
    // And the bookkeeping is still attempted — the fix must not have simply
    // deleted it.
    sent.length = 0;
    addOutgoing.mockClear();
    addOutgoing.mockResolvedValueOnce(undefined);

    await sendPeerRegistration(1n, 2n, 'bob');

    expect(addOutgoing).toHaveBeenCalledOnce();
  });
});
