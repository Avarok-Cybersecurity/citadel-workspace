/**
 * A Connect has exactly three terminal answers, and registration is a Connect.
 *
 * `connect.rs` returns `ConnectSuccess`, `ConnectFailure` or
 * `SessionAlreadyActive` — nothing else settles it. With
 * `connect_after_register` the internal service re-dispatches a real Connect
 * under the SAME request_id (`register.rs:74-86`), so all three arrive at the
 * registration handler.
 *
 * It handled two. The third fell through to the 30s timeout and reported
 * "Registration timed out" for a registration that had SUCCEEDED — the exact
 * failure `registration-connect-failure.test.ts` was written for, one variant
 * later. The comment describing that failure sits four lines above the branch
 * that was missing.
 *
 * `SessionAlreadyActive` resolves rather than rejects, matching what
 * `useLoginHandler` does with it: a live session for these credentials is the
 * outcome the caller asked for, not an error.
 *
 * Both wire shapes are asserted. The service sends some variants at the top
 * level and some inside `Response`, and matching only one form is how the
 * ConnectFailure branch came to be half-written.
 */
import { describe, it, expect, vi } from 'vitest';
import { createRegistrationResponseHandler } from '../registration-response-handler';

const REQ: 'req-1' = 'req-1';

function harness(): {
  handler: (raw: unknown) => void;
  resolve: ReturnType<typeof vi.fn>;
  reject: ReturnType<typeof vi.fn>;
  cleanup: ReturnType<typeof vi.fn>;
  seen: Record<string, unknown>[];
} {
  const resolve: ReturnType<typeof vi.fn> = vi.fn();
  const reject: ReturnType<typeof vi.fn> = vi.fn();
  const cleanup: ReturnType<typeof vi.fn> = vi.fn();
  const seen: Record<string, unknown>[] = [];
  const handler: (raw: unknown) => void = createRegistrationResponseHandler(REQ, resolve, reject, cleanup, {
    handleConnectSuccess: async (payload, res) => { seen.push(payload); res({ cid: String(payload.cid) }); },
    setShowNotInitializedModal: vi.fn(),
    onRecoveryCodes: vi.fn(), username: 'alice',
  });
  return { handler, resolve, reject, cleanup, seen };
}

describe('every terminal answer to the re-dispatched Connect', () => {
  it('settles on a TOP-LEVEL SessionAlreadyActive rather than timing out', async () => {
    const { handler, resolve, reject, cleanup, seen } = harness();

    handler({ SessionAlreadyActive: { request_id: REQ, cid: 42n, username: 'ada', message: 'already live' } });
    await Promise.resolve();

    expect(reject).not.toHaveBeenCalled();
    expect(resolve).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledOnce();
    // The cid must be the one the service reported, not a placeholder: the
    // caller stores credentials against it.
    expect(seen[0]?.cid).toBe(42n);
  });

  it('settles on the `Response`-wrapped SessionAlreadyActive too', async () => {
    const { handler, resolve, cleanup, seen } = harness();

    handler({ Response: { SessionAlreadyActive: { request_id: REQ, cid: 7n, username: 'ada' } } });
    await Promise.resolve();

    expect(resolve).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(seen[0]?.cid).toBe(7n);
  });

  it('ignores a SessionAlreadyActive for somebody else\'s request', () => {
    const { handler, resolve, reject, cleanup } = harness();

    handler({ SessionAlreadyActive: { request_id: 'someone-else', cid: 42n } });

    // Without this the test above would pass on a handler that settled every
    // SessionAlreadyActive it saw, which would resolve one tab's registration
    // out of another tab's session.
    expect(resolve).not.toHaveBeenCalled();
    expect(reject).not.toHaveBeenCalled();
    expect(cleanup).not.toHaveBeenCalled();
  });
});
