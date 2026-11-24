/**
 * RegisterSuccess carries the new account's recovery phrase and arrives ahead of the connect's own answer, under the same
 * request id. It is handed to the caller -- to show once -- and the wait goes
 * on: RegisterSuccess is not the outcome, ConnectSuccess is. Both wire shapes,
 * as the sibling tests do.
 *
 * No doubles: the handler is driven directly.
 */
import { describe, it, expect, vi, type Mock } from 'vitest';
import { createRegistrationResponseHandler } from '../registration-response-handler';
import { AdmissionRefusal, RegisteredAwaitingSignIn } from '@/lib/admission/refusal';

const REQ: 'req-1' = 'req-1';
const PHRASE: string[] = Array.from({ length: 24 }, (_v: unknown, i: number) => `word${i}`);

function harness(): { handler: (raw: unknown) => void; resolve: Mock; reject: Mock; cleanup: Mock; secret: Mock } {
  const resolve: Mock = vi.fn();
  const reject: Mock = vi.fn();
  const cleanup: Mock = vi.fn();
  const secret: Mock = vi.fn();
  const handler: (raw: unknown) => void = createRegistrationResponseHandler(REQ, resolve, reject, cleanup, {
    handleConnectSuccess: async (payload, res) => { res({ cid: String(payload.cid) }); },
    setShowNotInitializedModal: vi.fn(),
    onRecoveryPhrase: secret, username: 'alice',
  });
  return { handler, resolve, reject, cleanup, secret };
}

describe('the recovery phrase in RegisterSuccess', () => {
  it('reaches the caller, and the registration waits for the connect answer', async () => {
    const { handler, resolve, cleanup, secret } = harness();
    handler({ RegisterSuccess: { cid: 9n, request_id: REQ, recovery_phrase: PHRASE } });
    await Promise.resolve();
    expect(secret).toHaveBeenCalledExactlyOnceWith(PHRASE);
    expect(resolve).not.toHaveBeenCalled();
    expect(cleanup).not.toHaveBeenCalled();

    handler({ ConnectSuccess: { cid: 9n, request_id: REQ } });
    await Promise.resolve();
    expect(resolve).toHaveBeenCalledExactlyOnceWith({ cid: '9' });
  });

  it('is read from the Response-wrapped shape too', () => {
    const { handler, secret } = harness();
    handler({ Response: { RegisterSuccess: { cid: 9n, request_id: REQ, recovery_phrase: PHRASE } } });
    expect(secret).toHaveBeenCalledExactlyOnceWith(PHRASE);
  });

  it('is not taken from another registration', () => {
    const { handler, secret } = harness();
    handler({ RegisterSuccess: { cid: 9n, request_id: 'someone-else', recovery_phrase: PHRASE } });
    expect(secret).not.toHaveBeenCalled();
  });

  it('hands over nothing when the answer carries no phrase', () => {
    const { handler, secret } = harness();
    handler({ RegisterSuccess: { cid: 9n, request_id: REQ } });
    expect(secret).not.toHaveBeenCalled();
  });
});

describe('a workspace that asks for a human check', () => {
  it('registered, then the follow-up connect refused for the spent token: awaiting sign-in, not a failure', () => {
    const { handler, reject } = harness();
    handler({ RegisterSuccess: { cid: 9n, request_id: REQ, recovery_phrase: PHRASE } });
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
