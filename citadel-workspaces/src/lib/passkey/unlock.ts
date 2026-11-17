/**
 * Sign-in with a passkey: one assertion, then the ordinary password login.
 *
 * The page asks the authenticator for this account's PRF output, derives the
 * KEK, unwraps the DEK, opens the password and hands it to the SAME login call
 * the password form uses. The agent and server see a Connect exactly as if the
 * password had been typed.
 *
 * Every way this can fail after the ceremony -- a record for a credential we do
 * not hold, a PRF that did not answer, a tag that did not verify -- is one of
 * the UI's categories and no finer.
 */
import { debugLog } from '@/lib/debug-config';
import { type Bytes, bytesEqual, randomBytes } from './bytes';
import { type Assertion, type AuthenticatorPort, PasskeyError } from './authenticator';
import { type CredentialBinding, EnvelopeError, deriveKek, openPassword, unwrapDek } from './envelope';
import type { AccountRecord, CredentialRecord } from './records';
import { type PasskeyStore, listCredentials, loadAccount } from './repository';

export interface PasskeyDeps {
  store: PasskeyStore;
  authenticator: AuthenticatorPort;
  rpId: string;
  rpName: string;
  now: () => number;
}

export interface Unlocked {
  account: AccountRecord;
  credentials: CredentialRecord[];
  credential: CredentialRecord;
  dek: CryptoKey;
  password: string;
}

export const bindingFor = (c: CredentialRecord): CredentialBinding => ({
  rpId: c.rpId, username: c.username, cid: c.cid, credentialId: c.credentialId,
});

/**
 * Open the account's envelope with one of its keys.
 *
 * `extractableDek` is true only for adding another key, which must wrap the
 * same DEK again.
 */
export async function unlockAccount(deps: PasskeyDeps, username: string, extractableDek: boolean): Promise<Unlocked> {
  const account: AccountRecord | null = await loadAccount(deps.store, deps.rpId, username);
  const credentials: CredentialRecord[] = account ? await listCredentials(deps.store, deps.rpId, username) : [];
  if (!account || credentials.length === 0) throw new PasskeyError('not-set-up-here');

  const assertion: Assertion = await deps.authenticator.get({
    rpId: deps.rpId,
    challenge: randomBytes(32),
    allow: credentials.map((c) => ({ id: c.credentialId, transports: c.transports, prfSalt: c.prfSalt })),
  });
  const credential: CredentialRecord | undefined =
    credentials.find((c) => bytesEqual(c.credentialId, assertion.credentialId));
  if (!credential) throw new PasskeyError('not-set-up-here');
  const prf: Bytes | null = assertion.prfFirst;
  if (!prf) throw new PasskeyError('unsupported');

  try {
    const kek: CryptoKey = await deriveKek(prf, bindingFor(credential));
    const dek: CryptoKey = await unwrapDek(
      { iv: credential.dekIv, ciphertext: credential.wrappedDek }, kek, bindingFor(credential), extractableDek,
    );
    const password: string = await openPassword(
      { iv: account.passwordIv, ciphertext: account.sealedPassword }, dek,
      { rpId: account.rpId, username: account.username, cid: account.cid },
    );
    return { account, credentials, credential, dek, password };
  } catch (error) {
    if (error instanceof EnvelopeError) {
      // Named without a secret or a byte of the record: which account, not why.
      debugLog('Passkey', 'A passkey record for this account did not open; treating it as absent');
      throw new PasskeyError('not-set-up-here');
    }
    throw error;
  }
}

/**
 * Unlock, then sign in with the existing password login.
 *
 * Read-only since option A was retired: the sign-in that follows moves the
 * account to a server-verified key and deletes these records
 * (lib/sign-in/legacy.ts). Writing "last used" here would put back a record the
 * migration had just removed.
 */
export async function signInWithPasskey(
  deps: PasskeyDeps, username: string, login: (username: string, password: string) => Promise<void>,
): Promise<void> {
  const unlocked: Unlocked = await unlockAccount(deps, username, false);
  await login(username, unlocked.password);
}
