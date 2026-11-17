/**
 * Client-side mirror of the server's rules for the optional profile fields.
 *
 * SOURCE OF TRUTH — citadel-workspace-server-kernel/src/kernel/profile_limits.rs:
 *   MAX_EMAIL_LEN = 254 bytes, shape: one '@', non-empty either side, no whitespace
 *   MAX_TITLE_LEN = 64 bytes
 *   an empty string clears the field and is always accepted
 *
 * Mirrored for the reason `credential-rules.ts` gives: a browser cannot read
 * Rust constants. `cargo test -p citadel-workspace-server-kernel
 * profile_limits_mirror` fails if the server's numbers move.
 */
import { byteLength } from './credential-rules';

export const PROFILE_LIMITS: { readonly email: 254; readonly title: 64 } = {
  email: 254,
  title: 64,
} as const;

/** Returns a human-readable error, or null when the value may be sent. */
export function validateProfileEmail(email: string): string | null {
  if (email === '') return null;
  if (byteLength(email) > PROFILE_LIMITS.email) {
    return `Email must be ${PROFILE_LIMITS.email} characters or fewer`;
  }
  const at: number = email.indexOf('@');
  const shaped: boolean =
    at > 0 && at === email.lastIndexOf('@') && at < email.length - 1 && !/\s/.test(email);
  return shaped ? null : 'Enter an email like name@example.com';
}

export function validateProfileTitle(title: string): string | null {
  if (byteLength(title) > PROFILE_LIMITS.title) {
    return `Job title must be ${PROFILE_LIMITS.title} characters or fewer`;
  }
  return null;
}
