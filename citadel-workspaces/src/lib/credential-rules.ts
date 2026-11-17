/**
 * Client-side mirror of the Citadel SDK's credential contract.
 *
 * The SDK validates credentials server-side and rejects the whole registration
 * with a generic error. Before this module the UI knew none of the rules, so
 * the only way to discover them was to fill in the entire form, submit, wait
 * for a round-trip, and read a toast saying "Something went wrong: Username
 * must be between 3 and 37 characters".
 *
 * The password rule is the one that actually bites: the maximum is 17, which is
 * SHORTER than what every password manager generates by default. Users with the
 * best credential hygiene were the ones getting rejected, with no hint why.
 *
 * SOURCE OF TRUTH — citadel_user/src/credentials.rs (citadel-protocol):
 *   MIN_USERNAME_LENGTH = 3    MAX_USERNAME_LENGTH = 37   + must not contain ' '
 *   MIN_PASSWORD_LENGTH = 7    MAX_PASSWORD_LENGTH = 17   + must not contain ' '
 *   MIN_NAME_LENGTH     = 2    MAX_NAME_LENGTH     = 77
 *
 * These constants are duplicated across a language boundary, which the SSOT
 * rule normally forbids. A browser cannot read Rust constants, so the choice is
 * between mirroring them and shipping no client-side validation at all. The
 * mirror is guarded: `cargo test -p citadel-workspace-types credential_mirror`
 * fails if an SDK bump moves any of these numbers.
 */

/**
 * Rust `String::len()` counts UTF-8 BYTES; JavaScript `.length` counts UTF-16
 * code units. They agree on ASCII and diverge everywhere else — "José" is 5
 * bytes and 4 units. Measuring in units would accept a name the server then
 * rejects, which is the exact failure this module exists to prevent.
 */
export const byteLength = (value: string): number => new TextEncoder().encode(value).length;

export const CREDENTIAL_LIMITS: { readonly username: { readonly min: 3; readonly max: 37; }; readonly password: { readonly min: 7; readonly max: 17; }; readonly fullName: { readonly min: 2; readonly max: 77; }; } = {
  username: { min: 3, max: 37 },
  password: { min: 7, max: 17 },
  fullName: { min: 2, max: 77 },
} as const;

/** Returns a human-readable error, or null when the value is acceptable. */
export function validateUsername(username: string): string | null {
  const { min, max } = CREDENTIAL_LIMITS.username;
  const len: number = byteLength(username);
  if (len < min) return `Username must be at least ${min} characters`;
  if (len > max) return `Username must be ${max} characters or fewer`;
  if (username.includes(' ')) return 'Username cannot contain spaces';
  return null;
}

export function validatePassword(password: string): string | null {
  const { min, max } = CREDENTIAL_LIMITS.password;
  const len: number = byteLength(password);
  if (len < min) return `Password must be at least ${min} characters`;
  if (len > max) return `Password must be ${max} characters or fewer`;
  if (password.includes(' ')) return 'Password cannot contain spaces';
  return null;
}

export function validateFullName(fullName: string): string | null {
  const { min, max } = CREDENTIAL_LIMITS.fullName;
  const len: number = byteLength(fullName);
  if (len < min) return `Full name must be at least ${min} characters`;
  if (len > max) return `Full name must be ${max} characters or fewer`;
  return null;
}
