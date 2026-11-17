/**
 * The security settings a user chooses at sign-in must reach the connection.
 *
 * `handleLogin` called `websocketService.connect(requestId, username, password,
 * undefined)`, and `auth-operations` fills that gap with
 * `getDefaultSecuritySettings()`. So every choice made in the Security Settings
 * dialog reached the hook's state and died there: a user who selected a higher
 * security level, a post-quantum KEM and a signature algorithm connected with
 * Standard / BestEffort / AES_GCM_256 and was told nothing.
 *
 * It then persisted the DEFAULTS into the stored session, so every reconnect
 * used them too — the choice was lost for the life of the session, not just the
 * first connect.
 *
 * The registration flow has always mapped these correctly. This asserts the
 * mapping the login flow now shares, and the two call sites that consume it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mapSecuritySettings, getDefaultSecuritySettings , type SessionSecuritySettings } from '@/lib/security-utils';
import { stripComments } from '@/test-utils/strip-comments';
import type { SecuritySettingsValues } from '@/components/SecuritySettings';

/**
 * Deliberately not the defaults, and cast rather than typed.
 *
 * What is under test is whether each field is ROUTED to the right place in the
 * wire shape — not whether these particular strings are valid members of their
 * enums. Using real alternates would tie the test to the algorithm list, which
 * is generated from Rust and changes; using the defaults would let a mapper
 * that ignored its input pass.
 */
const chosen: SecuritySettingsValues = {
  securityLevel: 'CHOSEN_LEVEL',
  secrecyMode: 'CHOSEN_SECRECY',
  encryptionAlgorithm: 'CHOSEN_ENCRYPTION',
  kemAlgorithm: 'CHOSEN_KEM',
  sigAlgorithm: 'CHOSEN_SIG',
  headerObfuscatorSettings: {},
} as unknown as Parameters<typeof mapSecuritySettings>[0];

describe('mapSecuritySettings', () => {
  it('carries every choice through to the wire shape', () => {
    const wire: SessionSecuritySettings = mapSecuritySettings(chosen);

    expect(wire.security_level).toBe('CHOSEN_LEVEL');
    expect(wire.secrecy_mode).toBe('CHOSEN_SECRECY');
    expect(wire.crypto_params.encryption_algorithm).toBe('CHOSEN_ENCRYPTION');
    expect(wire.crypto_params.kem_algorithm).toBe('CHOSEN_KEM');
    expect(wire.crypto_params.sig_algorithm).toBe('CHOSEN_SIG');
  });

  it('produces something different from the defaults', () => {
    // Without this the assertions above could pass against a mapper that
    // ignored its input and returned defaults that happened to match.
    const defaults: SessionSecuritySettings = getDefaultSecuritySettings();
    expect(mapSecuritySettings(chosen)).not.toEqual(defaults);
  });
});

describe('the login flow uses it', () => {
  const source: string = stripComments(
    readFileSync(join(process.cwd(), 'src/components/login-with-password.ts'), 'utf8'),
  );

  it('sends the chosen settings rather than undefined', () => {
    expect(source).not.toContain('connect(requestId, username, password, undefined)');
    expect(source).toContain('mapSecuritySettings(securitySettings)');
  });

  it('stores the chosen settings rather than the defaults', () => {
    // Persisting defaults meant every reconnect silently downgraded too.
    expect(source).not.toContain('securitySettings: getDefaultSecuritySettings()');
    expect(source).toContain('securitySettings: chosenSettings');
  });
});
