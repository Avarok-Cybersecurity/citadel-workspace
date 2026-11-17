/**
 * Recovery codes, PRF outputs, passwords and recovery codes typed at sign-in
 * never reach the console, whichever call site logs the message carrying them.
 *
 * The leader logs every message off the wire ("Message received from WASM
 * client"), and RegisterSuccess carries the account's ten recovery codes. Not
 * doubled: the real debugLog, and console.log observed with a spy.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { debugLog, errorLog } from '../debug-config';
import { REDACTED, redactSecrets } from '../redact-secrets';

afterEach(() => vi.restoreAllMocks());

const printed = (spy: ReturnType<typeof vi.spyOn>): string =>
  JSON.stringify(spy.mock.calls, (_k: string, v: unknown) => (typeof v === 'bigint' ? `${v}n` : v));

describe('logging a message that carries a secret', () => {
  it('prints the message without the recovery codes', () => {
    const log: ReturnType<typeof vi.spyOn> = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    debugLog('WebSocketInit', 'Message received from WASM client', {
      RegisterSuccess: { cid: 7n, request_id: 'r', recovery_codes: ['CODE-0001', 'CODE-0002'] },
    });
    expect(printed(log)).toContain('RegisterSuccess');
    expect(printed(log)).not.toContain('CODE-0001');
  });

  it('redacts the outcome of RegenerateRecoveryCodes, a PRF output and a typed code', () => {
    const err: ReturnType<typeof vi.spyOn> = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    errorLog('x', { SignInManagementSuccess: { outcome: { RecoveryCodes: ['CODE-0003'] } } },
      { SecurityKeyAnswer: { prf_output: [1, 2, 3], credential_id: [9] } },
      { Connect: { username: 'alice', password: [104, 105], recovery_code: [67], admission_token: 'XXXX.DUMMY.TOKEN.7' } });
    const text: string = printed(err);
    expect(text).not.toContain('CODE-0003');
    expect(text).not.toContain('[1,2,3]');
    expect(text).not.toContain('[104,105]');
    expect(text).not.toContain('DUMMY.TOKEN');
    expect(text).toContain('alice');
    expect(text).toContain('[9]');
  });

  it('leaves the original message as it was', () => {
    const message: { RegisterSuccess: { recovery_codes: string[] } } = { RegisterSuccess: { recovery_codes: ['CODE-0004'] } };
    expect(redactSecrets(message)).toEqual({ RegisterSuccess: { recovery_codes: REDACTED } });
    expect(message.RegisterSuccess.recovery_codes).toEqual(['CODE-0004']);
  });
});
