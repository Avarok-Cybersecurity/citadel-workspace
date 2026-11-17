/**
 * The form's email and job-title rules must refuse exactly what the server
 * refuses (profile_limits.rs), or the wizard sends a value that fails the
 * whole profile update after the account already exists.
 */
import { describe, it, expect } from 'vitest';
import { PROFILE_LIMITS, validateProfileEmail, validateProfileTitle } from '../profile-rules';

describe('profile email rule', () => {
  it('accepts a plain address and an empty one (empty clears)', () => {
    expect(validateProfileEmail('ada@example.com')).toBeNull();
    expect(validateProfileEmail('a@b')).toBeNull();
    expect(validateProfileEmail('')).toBeNull();
  });

  it.each(['ada', '@example.com', 'ada@', 'a@b@c', 'ada @example.com', 'ada@exa\tmple.com'])(
    'refuses %j',
    (email) => {
      expect(validateProfileEmail(email)).not.toBeNull();
    },
  );

  it('counts bytes, as the server does, up to 254', () => {
    const atLimit: string = `${'a'.repeat(PROFILE_LIMITS.email - 2)}@b`;
    expect(validateProfileEmail(atLimit)).toBeNull();
    expect(validateProfileEmail(`a${atLimit}`)).not.toBeNull();
    // 126 two-byte characters + "@b" = 254 bytes but only 128 UTF-16 units.
    expect(validateProfileEmail(`${'é'.repeat(127)}@b`)).not.toBeNull();
  });
});

describe('profile title rule', () => {
  it('accepts up to 64 bytes and refuses one more', () => {
    expect(validateProfileTitle('t'.repeat(PROFILE_LIMITS.title))).toBeNull();
    expect(validateProfileTitle('t'.repeat(PROFILE_LIMITS.title + 1))).not.toBeNull();
  });

  it('counts bytes, not characters', () => {
    // 33 characters, 66 bytes.
    expect(validateProfileTitle('é'.repeat(33))).not.toBeNull();
  });
});
