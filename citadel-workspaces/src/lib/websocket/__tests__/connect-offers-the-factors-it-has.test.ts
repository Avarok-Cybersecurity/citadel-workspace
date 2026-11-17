/**
 * A Connect says which factors this window offers, and only those.
 *
 * The server's policy decides what a sign-in needs (pq-sign-in.md): a
 * KeyOnly account sends no password, a recovery-code sign-in sends the code
 * and no password, and only a window that can run WebAuthn says it can answer
 * a key challenge -- one that says so falsely leaves the server waiting a
 * minute for a touch nobody can give.
 *
 * Doubled: the request sender, which is the socket.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SignInFactors } from '@/lib/sign-in/types';

const sendRequest: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(undefined);
const { AuthOperations } = await import('../auth-operations');

interface ConnectFields { password: number[] | null; security_key: boolean; recovery_code: number[] | null; admission_token: string | null }
const bytes = (text: string): number[] => Array.from(new TextEncoder().encode(text));

async function connectWith(factors: SignInFactors): Promise<ConnectFields> {
  await new AuthOperations({
    init: vi.fn().mockResolvedValue(undefined), sendRequest,
    claimSession: vi.fn(), disconnect: vi.fn(),
  }).connect('req-1', 'alice', 'citadel.example.com:12349', factors);
  return (sendRequest.mock.calls[0][0] as { Connect: ConnectFields }).Connect;
}

describe('the factors a Connect carries', () => {
  beforeEach(() => { sendRequest.mockClear(); });

  it('password and key: both, for a PasswordAndKey account to ask for the touch', async () => {
    expect(await connectWith({ password: 'hunter2', securityKey: true, recoveryCode: null, admissionToken: null }))
      .toMatchObject({ password: bytes('hunter2'), security_key: true, recovery_code: null });
  });

  it('key first: no password at all', async () => {
    expect(await connectWith({ password: null, securityKey: true, recoveryCode: null, admissionToken: null }))
      .toMatchObject({ password: null, security_key: true, recovery_code: null });
  });

  it('a recovery code: the code, trimmed, and no password', async () => {
    expect(await connectWith({ password: null, securityKey: false, recoveryCode: '  CODE-0001 ', admissionToken: null }))
      .toMatchObject({ password: null, security_key: false, recovery_code: bytes('CODE-0001') });
  });

  it('a human-check token, when the workspace asks for one', async () => {
    expect(await connectWith({ password: 'hunter2', securityKey: true, recoveryCode: null, admissionToken: 'XXXX.DUMMY.TOKEN.XXXX' }))
      .toMatchObject({ admission_token: 'XXXX.DUMMY.TOKEN.XXXX' });
  });

  it('nothing at all is refused before it is sent', async () => {
    await expect(connectWith({ password: null, securityKey: false, recoveryCode: null, admissionToken: null })).rejects.toThrow(/needs a password/);
    await expect(connectWith({ password: null, securityKey: false, recoveryCode: '   ', admissionToken: null })).rejects.toThrow(/recovery code is required/);
    expect(sendRequest).not.toHaveBeenCalled();
  });
});
