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
    expect(validatePassword('a'.repeat(64))).toBeNull();
    expect(validateFullName('Jo')).toBeNull();
    expect(validateFullName('a'.repeat(77))).toBeNull();
  });

  it('rejects one past each boundary', () => {
    expect(validateUsername('ab')).toMatch(/at least 3/);
    expect(validateUsername('a'.repeat(38))).toMatch(/37 characters or fewer/);
    expect(validatePassword('a'.repeat(6))).toMatch(/at least 7/);
    expect(validatePassword('a'.repeat(65))).toMatch(/64 characters or fewer/);
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
    expect(validatePassword('🔒'.repeat(17))).toMatch(/64 characters or fewer/);
  });

  it('counts a non-ASCII password in bytes at the 64-byte maximum', () => {
    // 'é' is 2 bytes and 1 UTF-16 unit.
    const atMax: string = `${'a'.repeat(60)}é${'b'.repeat(2)}`;
    expect([atMax.length, new TextEncoder().encode(atMax).length]).toEqual([63, 64]);
    expect(validatePassword(atMax)).toBeNull();

    const overMax: string = `${'a'.repeat(61)}é${'b'.repeat(2)}`;
    expect([overMax.length, new TextEncoder().encode(overMax).length]).toEqual([64, 65]);
    expect(validatePassword(overMax)).toMatch(/64 characters or fewer/);
  });

  it('accepts a password-manager-length password, the rule users used to hit', () => {
    // Typical 1Password/Bitwarden default output, refused when the maximum was 17.
    const managerLength: string = `${'Xk4$'.repeat(4)}pL`; // 18 characters, every class
    expect(managerLength.length).toBe(18);
    expect(validatePassword(managerLength)).toBeNull();
  });

  it('exposes the limits for maxLength attributes to consume', () => {
    expect(CREDENTIAL_LIMITS.username.max).toBe(37);
    expect(CREDENTIAL_LIMITS.password.max).toBe(64);
    expect(CREDENTIAL_LIMITS.fullName.max).toBe(77);
  });
});
