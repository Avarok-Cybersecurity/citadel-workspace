import { describe, it, expect } from 'vitest';
import {
  CREDENTIAL_LIMITS,
  validateUsername,
  validatePassword,
  validateFullName,
} from '../credential-rules';

describe('credential rules mirror the SDK contract', () => {
  it('accepts values at both boundaries', () => {
    expect(validateUsername('abc')).toBeNull();
    expect(validateUsername('a'.repeat(37))).toBeNull();
    expect(validatePassword('a'.repeat(7))).toBeNull();
    expect(validatePassword('a'.repeat(17))).toBeNull();
    expect(validateFullName('Jo')).toBeNull();
    expect(validateFullName('a'.repeat(77))).toBeNull();
  });

  it('rejects one past each boundary', () => {
    expect(validateUsername('ab')).toMatch(/at least 3/);
    expect(validateUsername('a'.repeat(38))).toMatch(/37 characters or fewer/);
    expect(validatePassword('a'.repeat(6))).toMatch(/at least 7/);
    expect(validatePassword('a'.repeat(18))).toMatch(/17 characters or fewer/);
    expect(validateFullName('J')).toMatch(/at least 2/);
    expect(validateFullName('a'.repeat(78))).toMatch(/77 characters or fewer/);
  });

  it('rejects spaces, which the SDK checks separately from length', () => {
    expect(validateUsername('john doe')).toMatch(/cannot contain spaces/);
    expect(validatePassword('hunter2 pw')).toMatch(/cannot contain spaces/);
    // Full name is the one field where spaces are legitimate.
    expect(validateFullName('John Doe')).toBeNull();
  });

  it('measures UTF-8 bytes, as Rust String::len does', () => {
    // 19 'é' = 38 UTF-8 bytes but only 19 UTF-16 units. A mirror using
    // .length would accept this and the server would then reject it.
    const nineteenAccents: string = 'é'.repeat(19);
    expect(nineteenAccents.length).toBe(19); // under the limit by JS counting
    expect(validateUsername(nineteenAccents)).toMatch(/37 characters or fewer/);

    // A 4-byte emoji is a single UTF-16 pair but 4 bytes to Rust.
    expect(validatePassword('🔒'.repeat(5))).toMatch(/17 characters or fewer/);
  });

  it('rejects a password-manager-length password, the rule users actually hit', () => {
    // Typical 1Password/Bitwarden default output.
    expect(validatePassword('Xk4$mQ2!vB9#nR7&pL')).toMatch(/17 characters or fewer/);
  });

  it('exposes the limits for maxLength attributes to consume', () => {
    expect(CREDENTIAL_LIMITS.username.max).toBe(37);
    expect(CREDENTIAL_LIMITS.password.max).toBe(17);
    expect(CREDENTIAL_LIMITS.fullName.max).toBe(77);
  });
});
