/**
 * RegisterSuccess carries the new account's recovery phrase (or an older
 * server's codes) and arrives ahead of the connect's own answer, under the same
 * request id. It is handed to the caller -- to show once -- and the wait goes
 * on: RegisterSuccess is not the outcome, ConnectSuccess is. Both wire shapes,
 * as the sibling tests do.
 *
 * No doubles: the handler is driven directly.
 */
import { describe, it, expect, vi } from 'vitest';
import { createRegistrationResponseHandler } from '../registration-response-handler';
import { AdmissionRefusal, RegisteredAwaitingSignIn } from '@/lib/admission/refusal';

const REQ: 'req-1' = 'req-1';
const CODES: string[] = ['CODE-0001', 'CODE-0002'];
const PHRASE: string[] = Array.from({ length: 24 }, (_v: unknown, i: number) => `word${i}`);

function harness(): { handler: (raw: unknown) => void; resolve: ReturnType<typeof vi.fn>; reject: ReturnType<typeof vi.fn>; cleanup: ReturnType<typeof vi.fn>; secret: ReturnType<typeof vi.fn> } {
  const resolve: ReturnType<typeof vi.fn> = vi.fn();
  const reject: ReturnType<typeof vi.fn> = vi.fn();
  const cleanup: ReturnType<typeof vi.fn> = vi.fn();
  const secret: ReturnType<typeof vi.fn> = vi.fn();
  const handler: (raw: unknown) => void = createRegistrationResponseHandler(REQ, resolve, reject, cleanup, {
    handleConnectSuccess: async (payload, res) => { res({ cid: String(payload.cid) }); },
    setShowNotInitializedModal: vi.fn(),
    onRecoverySecret: secret, username: 'alice',
  });
  return { handler, resolve, reject, cleanup, secret };
}

describe('the recovery phrase in RegisterSuccess', () => {
  it('reaches the caller, and the registration waits for the connect answer', async () => {
    const { handler, resolve, cleanup, secret } = harness();
    handler({ RegisterSuccess: { cid: 9n, request_id: REQ, recovery_codes: [], recovery_phrase: PHRASE } });
    await Promise.resolve();
    expect(secret).toHaveBeenCalledExactlyOnceWith({ kind: 'phrase', words: PHRASE });
    expect(resolve).not.toHaveBeenCalled();
    expect(cleanup).not.toHaveBeenCalled();

    handler({ ConnectSuccess: { cid: 9n, request_id: REQ } });
    await Promise.resolve();
    expect(resolve).toHaveBeenCalledExactlyOnceWith({ cid: '9' });
  });

  it('is read from the Response-wrapped shape too', () => {
    const { handler, secret } = harness();
    handler({ Response: { RegisterSuccess: { cid: 9n, request_id: REQ, recovery_codes: [], recovery_phrase: PHRASE } } });
    expect(secret).toHaveBeenCalledExactlyOnceWith({ kind: 'phrase', words: PHRASE });
  });

  it('is not taken from another registration', () => {
    const { handler, secret } = harness();
    handler({ RegisterSuccess: { cid: 9n, request_id: 'someone-else', recovery_codes: [], recovery_phrase: PHRASE } });
    expect(secret).not.toHaveBeenCalled();
  });

  it('falls back to an older server\'s codes, so they are never lost', () => {
    const { handler, secret } = harness();
    handler({ RegisterSuccess: { cid: 9n, request_id: REQ, recovery_codes: CODES } });
    expect(secret).toHaveBeenCalledExactlyOnceWith({ kind: 'codes', words: CODES });
  });

  it('hands over nothing from a server without post-quantum sign-in', () => {
    const { handler, secret } = harness();
    handler({ RegisterSuccess: { cid: 9n, request_id: REQ, recovery_codes: [] } });
    expect(secret).not.toHaveBeenCalled();
  });
});

describe('a workspace that asks for a human check', () => {
  it('registered, then the follow-up connect refused for the spent token: awaiting sign-in, not a failure', () => {
    const { handler, reject } = harness();
    handler({ RegisterSuccess: { cid: 9n, request_id: REQ, recovery_codes: CODES } });
    handler({ ConnectFailure: { cid: 0n, request_id: REQ, message: 'human check', reason_code: 'admission_required' } });
    expect(reject).toHaveBeenCalledExactlyOnceWith(new RegisteredAwaitingSignIn(9n));
    expect((reject.mock.calls[0][0] as RegisteredAwaitingSignIn).cid).toBe(9n);
  });

  it('refused before any account exists: the check is shown', () => {
    const { handler, reject } = harness();
    handler({ RegisterFailure: { cid: 0n, request_id: REQ, message: 'human check', reason_code: 'admission_required' } });
    expect(reject.mock.calls[0][0]).toBeInstanceOf(AdmissionRefusal);
  });
});
