import { describe, it, expect, vi } from 'vitest';
import {
  classifyPeerRegisterFailure,
  applyPeerRegisterFailure,
  type PeerRegisterFailureOutcome,
} from '@/components/p2p/peer-register-failure';

/**
 * `PeerRegisterFailure` names the LOCAL session, never the peer.
 *
 * The wire type is `{ cid, message, request_id }` — no `peer_cid` — and `cid`
 * is the session's own id (citadel-internal-service .../peer/register.rs). The
 * already-registered branch read `failure.cid` into a Set keyed by PEER cid, so
 * the user's own id was marked and the peer's row never was. CIDs are permanent,
 * so every reconnect re-registers, gets "already registered" back, and lands
 * here: pressing Connect again is a silent no-op indefinitely.
 *
 * The fix is structural rather than a corrected field read — the outcome carries
 * no cid at all, so there is nothing wrong left to reach for. These tests assert
 * that shape, because a later "helpful" restoration of `cid` is exactly how this
 * comes back.
 */
describe('a PeerRegisterFailure that means "already registered"', () => {
  const alreadyRegistered: Record<string, unknown> = {
    // 42 is THIS session. The peer is named only inside the message text.
    cid: 42n,
    message: 'Peer 99 is already registered',
    request_id: 'req-1',
  };

  it('does not offer a cid, because the one in the response is the wrong one', () => {
    const outcome: PeerRegisterFailureOutcome = classifyPeerRegisterFailure(alreadyRegistered);
    expect(outcome.kind).toBe('already-registered');
    expect(outcome, 'the outcome must not expose a cid at all').not.toHaveProperty('cid');
    expect(JSON.stringify(outcome)).not.toContain('42');
  });

  it('marks the peer without being told which, so the caller decides', () => {
    const markRegistered: ReturnType<typeof vi.fn> = vi.fn();
    const reportRefusal: ReturnType<typeof vi.fn> = vi.fn();
    applyPeerRegisterFailure(alreadyRegistered, { markRegistered, reportRefusal });
    expect(markRegistered).toHaveBeenCalledTimes(1);
    // No argument: passing one would let the wrong id back in.
    expect(markRegistered).toHaveBeenCalledWith();
    expect(reportRefusal).not.toHaveBeenCalled();
  });

  it('still reports a genuine refusal by reason', () => {
    // The control: the other branch must be unaffected, or "nothing is said"
    // would swallow real refusals too.
    const markRegistered: ReturnType<typeof vi.fn> = vi.fn();
    const reportRefusal: ReturnType<typeof vi.fn> = vi.fn();
    applyPeerRegisterFailure(
      { cid: 42n, message: 'no such peer', request_id: 'req-2' },
      { markRegistered, reportRefusal },
    );
    expect(reportRefusal).toHaveBeenCalledWith('no such peer');
    expect(markRegistered).not.toHaveBeenCalled();
  });
});
