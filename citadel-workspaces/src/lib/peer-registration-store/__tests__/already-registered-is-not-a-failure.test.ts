/**
 * "Peer already registered" is a success. CLAUDE.md says so outright:
 *
 *   Registrations are stored by CID pair and the CID never changes, so after a
 *   disconnect/reconnect the registration is still there. "Peer Already
 *   Registered" is NOT an Error — treat this as success, not failure.
 *
 * The agent answers `PeerRegisterFailure` for it
 * (`requests/peer/register.rs`), and three places in this codebase already
 * special-case it. `waitForAcceptResponse` did not, and its caller
 * (`lifecycle.ts`) awaits it on the line before `connectToPeer` — so the
 * rejection skipped the connect entirely and no P2P channel was ever opened.
 *
 * That is the shape of the CI failure: every agent-side send `to SERVER (no
 * peer_cid)`, and not one `[PeerChannelCreated]`, across six specs.
 */
import { describe, it, expect, vi } from 'vitest';
import { eventEmitter } from '../../event-emitter';
import { waitForAcceptResponse } from '../accept-matcher';

vi.mock('../../websocket/request-response', (): Record<string, unknown> => ({
  // The socket-loss wrapper is not what is under test; pass the promise through.
  failOnSocketLoss: (_label: string, promise: Promise<void>): Promise<void> => promise,
}));

const REQ: 'req-accept-1' = 'req-accept-1';
const PEER: bigint = 42n;
const SELF: bigint = 7n;

describe('accepting a peer registration', () => {
  it('resolves when the agent says the peer is already registered', async () => {
    const settled: Promise<void> = waitForAcceptResponse(REQ, PEER, SELF);

    eventEmitter.emit('websocket-message', {
      PeerRegisterFailure: { request_id: REQ, cid: SELF, message: 'Peer 42 is already registered' },
    });

    // `resolves` and not a try/catch: a rejection here is the defect, and it
    // must fail the test rather than be swallowed.
    await expect(settled).resolves.toBeUndefined();
  });

  it('still rejects a genuine registration failure', async () => {
    // The discrimination control. Resolving every PeerRegisterFailure would
    // satisfy the test above and turn a real refusal into a silent no-op.
    const settled: Promise<void> = waitForAcceptResponse(REQ, PEER, SELF);

    eventEmitter.emit('websocket-message', {
      PeerRegisterFailure: { request_id: REQ, cid: SELF, message: 'no such peer' },
    });

    await expect(settled).rejects.toThrow('no such peer');
  });

  it('ignores a failure belonging to somebody else\'s request', async () => {
    let settledEarly: boolean = false;
    const settled: Promise<void> = waitForAcceptResponse(REQ, PEER, SELF);
    void settled.then(() => { settledEarly = true; }, () => { settledEarly = true; });

    eventEmitter.emit('websocket-message', {
      PeerRegisterFailure: { request_id: 'someone-else', cid: SELF, message: 'already registered' },
    });
    await Promise.resolve();

    expect(settledEarly).toBe(false);
    // Settle it so the pending timer does not outlive the test.
    eventEmitter.emit('websocket-message', { PeerRegisterSuccess: { request_id: REQ, cid: SELF } });
    await settled;
  });
});
