/**
 * What Settings knows of the account's sign-in factors: the server's answer to
 * ListCredentials, kept current by each change's own outcome.
 *
 * Listing needs a step-up like every management request, so the section is
 * not re-listed after each change -- that would ask for the password again
 * after every rename. The server's outcome says what changed; this applies it.
 */
import type { AddedKey } from './enrol-key';
import type { SignInCredential, SignInManagementOutcome, SignInPolicy } from './types';

export interface Listing {
  policy: SignInPolicy;
  keys: SignInCredential[];
  /** Unused recovery codes. */
  codesLeft: number;
}

/** A Rust `None` arrives as an absent field; every reader below checks `null`. */
const present = (c: SignInCredential): SignInCredential =>
  ({ ...c, credential_id: c.credential_id ?? null, last_used_ms: c.last_used_ms ?? null });

export function listingOf(outcome: SignInManagementOutcome): Listing {
  if (typeof outcome !== 'object' || !('Credentials' in outcome)) throw new Error('The server did not list the sign-in factors');
  const { policy, credentials } = outcome.Credentials;
  return {
    policy,
    keys: credentials.filter((c: SignInCredential) => c.kind === 'SecurityKey').map(present),
    codesLeft: credentials.filter((c: SignInCredential) => c.kind === 'RecoveryCode' && !c.consumed).length,
  };
}

export const withKeyAdded = (l: Listing, added: AddedKey, label: string, nowMs: number): Listing => ({
  ...l,
  keys: [...l.keys, {
    id: added.id, kind: 'SecurityKey', label, credential_id: added.credentialId,
    created_ms: BigInt(nowMs), last_used_ms: null, consumed: false,
  }],
});

export const withKeyRenamed = (l: Listing, id: number, label: string): Listing =>
  ({ ...l, keys: l.keys.map((k: SignInCredential) => (k.id === id ? { ...k, label } : k)) });

export const withKeyRemoved = (l: Listing, id: number): Listing =>
  ({ ...l, keys: l.keys.filter((k: SignInCredential) => k.id !== id) });

export const withPolicy = (l: Listing, policy: SignInPolicy): Listing => ({ ...l, policy });

export const withNewCodes = (l: Listing, codes: readonly string[]): Listing => ({ ...l, codesLeft: codes.length });
