/**
 * With connect_after_register the internal service re-dispatches a Connect under
 * the SAME request_id, so its failure arrives as a TOP-LEVEL ConnectFailure —
 * the sibling of the top-level ConnectSuccess that was always handled. Only the
 * `Response`-wrapped form was matched, so a registration that SUCCEEDED and
 * whose connect failed fell through to the 30s timeout and reported
 * "Registration timed out". The user then retried and was told the username
 * already exists, for an account they did not know they owned.
 */
import { UNKNOWN_REASON_COPY } from '@/lib/connection/connect-refusal';
import { UsernameHeldElsewhere } from '@/lib/sessions/known-accounts';
import { describe, it, expect, vi   } from 'vitest';
import { createRegistrationResponseHandler } from '../registration-response-handler';

const REQ: "req-1" = 'req-1';

function harness(): { handler: (raw: unknown) => void; resolve: ReturnType<typeof vi.fn>; reject: ReturnType<typeof vi.fn>; cleanup: ReturnType<typeof vi.fn>; } {
  const resolve: ReturnType<typeof vi.fn> = vi.fn();
  const reject: ReturnType<typeof vi.fn> = vi.fn();
  const cleanup: ReturnType<typeof vi.fn> = vi.fn();
  const handler: (raw: unknown) => void = createRegistrationResponseHandler(REQ, resolve, reject, cleanup, {
    handleConnectSuccess: async (_p, res) => res({ cid: '42' }),
    setShowNotInitializedModal: vi.fn(),
    onRecoveryCodes: vi.fn(), username: 'alice',
  });
  return { handler, resolve, reject, cleanup };
}

describe('the registration response handler', () => {
  it('settles on a TOP-LEVEL ConnectFailure instead of waiting out the timeout', () => {
    const { handler, reject, cleanup } = harness();

    handler({ ConnectFailure: { request_id: REQ, message: 'peer refused' } });

    expect(reject).toHaveBeenCalledOnce();
    expect((reject.mock.calls[0][0] as Error).message).toBe('peer refused');
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('says the account exists when the service gives no reason', () => {
    const { handler, reject } = harness();

    handler({ ConnectFailure: { request_id: REQ } });

    // Silence here previously became "Registration timed out", which is the
    // opposite of what happened: the account was created.
    expect((reject.mock.calls[0][0] as Error).message).toMatch(/account was created/i);
  });

  it('a RegisterFailure for a reason newer than this page says to reload it', () => {
    const { handler, reject } = harness();

    handler({ RegisterFailure: { request_id: REQ, message: 'raw', reason_code: 'unknown' } });

    expect((reject.mock.calls[0][0] as Error).message).toBe(UNKNOWN_REASON_COPY);
  });

  it('a held username is the typed refusal, naming the server', () => {
    const { handler, reject } = harness();

    handler({ RegisterFailure: { request_id: REQ, message: 'raw', reason_code: 'username_held_for_another_server', held_for_server: 'bench.work.avarok.net' } });

    expect(reject.mock.calls[0][0]).toBeInstanceOf(UsernameHeldElsewhere);
  });

  it('still settles on the Response-wrapped ConnectFailure', () => {
    const { handler, reject } = harness();

    handler({ Response: { ConnectFailure: { request_id: REQ, message: 'wrapped' } } });

    expect((reject.mock.calls[0][0] as Error).message).toBe('wrapped');
  });

  it('ignores a ConnectFailure belonging to a different request', () => {
    const { handler, reject, resolve } = harness();

    handler({ ConnectFailure: { request_id: 'someone-else', message: 'not mine' } });

    expect(reject).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
  });

  it('still resolves on a top-level ConnectSuccess', async () => {
    const { handler, resolve } = harness();

    handler({ ConnectSuccess: { request_id: REQ, cid: '42' } });
    await Promise.resolve();

    expect(resolve).toHaveBeenCalledWith({ cid: '42' });
  });
});
