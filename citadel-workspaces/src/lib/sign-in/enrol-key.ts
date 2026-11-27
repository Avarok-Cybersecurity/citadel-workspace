/**
 * Adding a security key: the server asks for it, the browser makes it.
 *
 * AddSecurityKey goes out with the key's name alone. Once the server has named
 * its relying party and the keys the account already has, the agent relays an
 * Enrol challenge whose ceremony is Register, and the prompt answers it
 * (key-answer.ts): registerSecurityKey() runs create() with the PRF extension
 * requested, and a key that does not report PRF support is refused right there
 * and the browser asked to forget the credential. Then get() of the new
 * credential gives its PRF output at the server's salt, and the agent proves
 * the derived ML-KEM key to the server in the same flow (pq-sign-in.md,
 * Registration step 5), so a key nobody holds cannot be enrolled.
 */
import { debugLog } from '@/lib/debug-config';
import { type CreatedCredential, type AuthenticatorPort, PasskeyError } from '@/lib/passkey/authenticator';
import { type Bytes, copyBytes, randomBytes } from '@/lib/passkey/bytes';
import type { Send } from './key-answer';
import { manageSignIn } from './management';
import type { AccountRef, SignInManagementOutcome, StepUp } from './types';

export interface EnrolDeps {
  authenticator: AuthenticatorPort;
  rpName: string;
  send: Send;
}

export interface NewKey {
  account: AccountRef;
  label: string;
}

/** What a Register ceremony names: the relying party, the account, and the keys it must not be made on. */
export interface Registration {
  rpId: string;
  userId: Uint8Array;
  userName: string;
  excludeCredentialIds: Uint8Array[];
}

export const prfSupported = (created: CreatedCredential): boolean =>
  created.prf.first !== null || created.prf.enabled === true;

/** create() for the key a Register ceremony asks for; refuses one without PRF before it is answered. */
export async function registerSecurityKey(
  deps: Pick<EnrolDeps, 'authenticator' | 'rpName'>, registration: Registration,
): Promise<Bytes> {
  // A browser with no PRF at all: making the passkey would only leave one behind that cannot sign in.
  if (await deps.authenticator.prfRuledOut()) throw new PasskeyError('unsupported');
  const created: CreatedCredential = await deps.authenticator.create({
    rpId: registration.rpId,
    rpName: deps.rpName,
    userHandle: copyBytes(registration.userId),
    userName: registration.userName,
    userDisplayName: registration.userName,
    challenge: randomBytes(32),
    excludeCredentialIds: registration.excludeCredentialIds.map((id: Uint8Array) => copyBytes(id)),
    // Asks the authenticator to enable PRF; the salt that matters is the server's, at get().
    prfSalt: randomBytes(32),
  });
  if (created.prf.first) created.prf.first.fill(0);
  if (!prfSupported(created)) {
    try {
      await deps.authenticator.signalUnknownCredential(registration.rpId, created.credentialId);
    } catch (error) {
      debugLog('SignIn', 'signalUnknownCredential failed (non-critical)', error);
    }
    throw new PasskeyError('unsupported');
  }
  return created.credentialId;
}

/** A key the server enrolled: its factor id. Its credential id is the server's to list. */
export interface AddedKey { id: number }

/** Ask the server to enrol a key; the prompt makes it when the server's Enrol challenge arrives. */
export async function addSecurityKey(deps: EnrolDeps, key: NewKey, stepUp: StepUp): Promise<AddedKey> {
  // A browser with no PRF at all: the key the server would ask for could never be made here.
  if (await deps.authenticator.prfRuledOut()) throw new PasskeyError('unsupported');
  const outcome: SignInManagementOutcome = await manageSignIn(
    deps.send, key.account.cid,
    { AddSecurityKey: { label: key.label } },
    { ...stepUp, security_key: true },
  );
  if (typeof outcome === 'object' && 'Added' in outcome) return { id: outcome.Added.id };
  throw new Error('The server did not report the key it added');
}
