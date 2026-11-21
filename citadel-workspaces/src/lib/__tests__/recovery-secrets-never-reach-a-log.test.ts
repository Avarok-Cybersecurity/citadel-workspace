/**
 * Recovery phrases, PRF outputs, passwords and human-check tokens never reach
 * the console, whichever call site logs the message
 * carrying them.
 *
 * The leader logs every message off the wire ("Message received from WASM
 * client"), and RegisterSuccess carries the account's recovery phrase. Not
 * doubled: the real debugLog, and console.log observed with a spy.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { debugLog, errorLog } from '../debug-config';
import { REDACTED, redactSecrets } from '../redact-secrets';

afterEach(() => vi.restoreAllMocks());

const printed = (spy: ReturnType<typeof vi.spyOn>): string =>
  JSON.stringify(spy.mock.calls, (_k: string, v: unknown) => (typeof v === 'bigint' ? `${v}n` : v));

describe('logging a message that carries a secret', () => {
  it('prints the message without the recovery phrase', () => {
    const log: ReturnType<typeof vi.spyOn> = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    debugLog('WebSocketInit', 'Message received from WASM client', {
      RegisterSuccess: { cid: 7n, request_id: 'r', recovery_phrase: ['abandon', 'ability'] },
    });
    expect(printed(log)).toContain('RegisterSuccess');
    expect(printed(log)).not.toContain('abandon');
  });

  it('redacts a PRF output, a password and a human-check token', () => {
    const err: ReturnType<typeof vi.spyOn> = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    errorLog('x', { SecurityKeyAnswer: { prf_output: [1, 2, 3], credential_id: [9] } },
      { Connect: { username: 'alice', password: [104, 105], admission_token: 'XXXX.DUMMY.TOKEN.7' } });
    const text: string = printed(err);
    expect(text).not.toContain('[1,2,3]');
    expect(text).not.toContain('[104,105]');
    expect(text).not.toContain('DUMMY.TOKEN');
    expect(text).toContain('alice');
    expect(text).toContain('[9]');
  });

  it('redacts the recovery phrase wherever it travels, and a password set from the console', () => {
    const err: ReturnType<typeof vi.spyOn> = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    errorLog('x',
      { RegisterSuccess: { cid: 7n, request_id: 'r', recovery_phrase: ['abandon', 'ability'] } },
      { SignInManagementSuccess: { outcome: { RecoveryPhrase: ['zebra', 'zone'] } } },
      { RecoverAccount: { username: 'alice', phrase: [97, 98, 99], device_label: 'My Mac' } },
      { Connect: { username: 'alice', recovery_phrase: [100, 101] } },
      { SignInManagement: { op: { SetPassword: { new_password: [110, 112] } } } },
      { IdentityImport: { phrase: [120, 121], unlock_password: [122, 123] } });
    const text: string = printed(err);
    for (const secret of ['abandon', 'zebra', '[97,98,99]', '[100,101]', '[110,112]', '[120,121]', '[122,123]']) expect(text).not.toContain(secret);
    expect(text).toContain('My Mac');
    expect(text).toContain('SetPassword');
  });

  it('leaves the original message as it was', () => {
    const message: { RegisterSuccess: { recovery_phrase: string[] } } = { RegisterSuccess: { recovery_phrase: ['abandon'] } };
    expect(redactSecrets(message)).toEqual({ RegisterSuccess: { recovery_phrase: REDACTED } });
    expect(message.RegisterSuccess.recovery_phrase).toEqual(['abandon']);
  });
});
