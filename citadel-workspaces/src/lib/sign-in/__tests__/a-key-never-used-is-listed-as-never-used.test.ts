// @vitest-environment node
/**
 * The agent's listing reaches JS through serde-wasm-bindgen, which spells a
 * Rust `None` as an absent field. A key that has never signed anyone in has no
 * `last_used_ms`, and the row must say "Not used yet", not "Last used Invalid Date".
 */
import { describe, expect, it } from 'vitest';
import type { SignInCredential, SignInManagementOutcome } from '../types';
import { listingOf } from '../listing';

function neverUsedKey(): SignInCredential {
  const wire: Omit<SignInCredential, 'last_used_ms'> = {
    id: 7, kind: 'SecurityKey', label: 'YubiKey', credential_id: [1, 2], created_ms: 5n, consumed: false,
  };
  return wire as SignInCredential;
}

describe('a listed key that was never used', () => {
  it('has last_used_ms null, the one spelling every reader checks', () => {
    const outcome: SignInManagementOutcome = { Credentials: { policy: 'PasswordAndKey', credentials: [neverUsedKey()] } };
    expect(listingOf(outcome).keys[0].last_used_ms).toBeNull();
  });
});
