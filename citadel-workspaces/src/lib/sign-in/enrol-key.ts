/**
 * Adding a security key: the browser makes the credential, the server enrols it.
 *
 * create() runs first, with the PRF extension requested. A key that does not
 * report PRF support is refused right there -- before the agent or the server
 * hears of it -- and the browser is asked to forget the credential. Only then
 * does AddSecurityKey go out; the server answers with an Enrol challenge for the
 * new credential, the prompt runs get() for its PRF output, and the agent proves
 * the derived ML-KEM key to the server in the same flow (pq-sign-in.md,
 * Registration step 5), so a key nobody holds cannot be enrolled.
 */
import { debugLog } from '@/lib/debug-config';
import { type CreatedCredential, type AuthenticatorPort, PasskeyError } from '@/lib/passkey/authenticator';
import { type Bytes, copyBytes, randomBytes, utf8 } from '@/lib/passkey/bytes';
import type { Send } from './key-answer';
import { manageSignIn } from './management';
import type { AccountRef, SignInManagementOutcome, StepUp } from './types';

export interface EnrolDeps {
  authenticator: AuthenticatorPort;
  rpId: string;
  rpName: string;
  send: Send;
}

export interface NewKey {
  account: AccountRef;
  label: string;
  /** Keys the account already has, so the same authenticator is not enrolled twice. */
  existingCredentialIds: number[][];
}

/**
 * The WebAuthn user handle: one per account, the same on every key, and
 * derived rather than random so it names the account without naming the user.
 */
export async function userHandleFor(account: AccountRef): Promise<Bytes> {
  const label: Bytes = utf8(`citadel/sign-in/v2/user|${account.tenant}|${account.cid.toString()}`);
  const digest: ArrayBuffer = await crypto.subtle.digest('SHA-256', label);
  return copyBytes(new Uint8Array(digest).slice(0, 16));
}

export const prfSupported = (created: CreatedCredential): boolean =>
  created.prf.first !== null || created.prf.enabled === true;

/** create() for a new key; refuses one without PRF before anything leaves the page. */
export async function createSecurityKey(deps: EnrolDeps, key: NewKey): Promise<Bytes> {
  // A browser with no PRF at all: making the passkey would only leave one behind that cannot sign in.
  if (await deps.authenticator.prfRuledOut()) throw new PasskeyError('unsupported');
  const created: CreatedCredential = await deps.authenticator.create({
    rpId: deps.rpId,
    rpName: deps.rpName,
    userHandle: await userHandleFor(key.account),
    userName: key.account.username,
    userDisplayName: key.account.username,
    challenge: randomBytes(32),
    excludeCredentialIds: key.existingCredentialIds.map((id: number[]) => copyBytes(Uint8Array.from(id))),
    // Asks the authenticator to enable PRF; the salt that matters is the server's, at get().
    prfSalt: randomBytes(32),
  });
  if (created.prf.first) created.prf.first.fill(0);
  if (!prfSupported(created)) {
    try {
      await deps.authenticator.signalUnknownCredential(deps.rpId, created.credentialId);
    } catch (error) {
      debugLog('SignIn', 'signalUnknownCredential failed (non-critical)', error);
    }
    throw new PasskeyError('unsupported');
  }
  return created.credentialId;
}

/** A key the server enrolled: its factor id, and the WebAuthn credential behind it. */
export interface AddedKey { id: number; credentialId: number[] }

/** Make the key, then enrol it. */
export async function addSecurityKey(deps: EnrolDeps, key: NewKey, stepUp: StepUp): Promise<AddedKey> {
  const credentialId: Bytes = await createSecurityKey(deps, key);
  const outcome: SignInManagementOutcome = await manageSignIn(
    deps.send, key.account.cid,
    { AddSecurityKey: { credential_id: Array.from(credentialId), label: key.label } },
    { ...stepUp, security_key: true },
  );
  if (typeof outcome === 'object' && 'Added' in outcome) return { id: outcome.Added.id, credentialId: Array.from(credentialId) };
  throw new Error('The server did not report the key it added');
}
