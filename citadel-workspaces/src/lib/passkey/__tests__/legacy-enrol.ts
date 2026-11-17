/**
 * TEST FIXTURE: how the retired option A wrote its records.
 *
 * Moved here verbatim from lib/passkey/enrol.ts when the app stopped sealing
 * passwords (docs/plans/pq-sign-in.md). The app still READS these records, to
 * move their owners to a server-verified key, so the tests still need to write
 * them exactly as the old enrolment did.
 *
 * Adding a passkey or security key to an account.
 *
 * The first key needs the password the user has just proved (a successful
 * login, or the agent's password check in settings). Every later key opens the
 * existing envelope with a key already enrolled and wraps the same DEK again,
 * so each key unwraps the one DEK and removing one leaves the others working.
 *
 * Support for PRF is judged by what the ceremony returned and by a decrypt of
 * the records about to be written -- never by getClientCapabilities, which
 * reports PRF for providers that then return nothing. Nothing is written until
 * that round trip has produced the password it was given.
 */
import { debugLog } from '@/lib/debug-config';
import { type Bytes, bytesEqual, randomBytes } from '../bytes';
import { type Assertion, type CreatedCredential, PasskeyError } from '../authenticator';
import {
  type AccountBinding, type CredentialBinding, type Sealed,
  deriveKek, generateDek, openPassword, sealPassword, unwrapDek, wrapDek,
} from '../envelope';
import {
  type AccountRecord, type CredentialRecord, RECORD_VERSION,
  decodeAccountRecord, decodeCredentialRecord, encodeAccountRecord, encodeCredentialRecord,
} from '../records';
import { credentialKey, loadAccount, listCredentials, saveAccount, saveCredential } from '../repository';
import { type PasskeyDeps, type Unlocked, unlockAccount } from '../unlock';

export interface EnrolRequest {
  username: string;
  cid: bigint;
  label: string;
  /**
   * The verified password when the account has no key yet; null to open the
   * existing envelope with an enrolled key instead.
   */
  password: string | null;
}

interface Envelope {
  account: AccountRecord;
  dek: CryptoKey;
  password: string;
  existing: CredentialRecord[];
  /** Keys bound to an envelope this enrolment replaces; they can no longer open it. */
  stale: CredentialRecord[];
}

async function freshEnvelope(deps: PasskeyDeps, req: EnrolRequest, password: string): Promise<Envelope> {
  const dek: CryptoKey = await generateDek();
  const binding: AccountBinding = { rpId: deps.rpId, username: req.username, cid: req.cid };
  const sealed: Sealed = await sealPassword(password, dek, binding);
  const now: number = deps.now();
  return {
    dek, password, existing: [], stale: [],
    account: {
      v: RECORD_VERSION, kind: 'account', rpId: deps.rpId, username: req.username, cid: req.cid,
      userHandle: randomBytes(16), passwordIv: sealed.iv, sealedPassword: sealed.ciphertext,
      createdAt: now, updatedAt: now,
    },
  };
}

async function openEnvelope(deps: PasskeyDeps, req: EnrolRequest): Promise<Envelope> {
  const account: AccountRecord | null = await loadAccount(deps.store, deps.rpId, req.username);
  const existing: CredentialRecord[] = account ? await listCredentials(deps.store, deps.rpId, req.username) : [];
  if (!account || existing.length === 0 || account.cid !== req.cid) {
    // No usable envelope: start one, which needs the password.
    if (req.password === null) throw new PasskeyError('not-set-up-here');
    return { ...(await freshEnvelope(deps, req, req.password)), stale: existing };
  }
  const unlocked: Unlocked = await unlockAccount(deps, req.username, true);
  return {
    account: unlocked.account, dek: unlocked.dek, password: unlocked.password,
    existing: unlocked.credentials, stale: [],
  };
}

/** create() with PRF; if it was enabled but not evaluated, one get() for the new key. */
async function prfForNewCredential(deps: PasskeyDeps, created: CreatedCredential, prfSalt: Bytes): Promise<Bytes> {
  if (created.prf.first) return created.prf.first;
  if (created.prf.enabled === true) {
    const assertion: Assertion = await deps.authenticator.get({
      rpId: deps.rpId, challenge: randomBytes(32),
      allow: [{ id: created.credentialId, transports: created.transports, prfSalt }],
    });
    if (assertion.prfFirst && bytesEqual(assertion.credentialId, created.credentialId)) return assertion.prfFirst;
  }
  try {
    await deps.authenticator.signalUnknownCredential(deps.rpId, created.credentialId);
  } catch (error) {
    debugLog('Passkey', 'signalUnknownCredential failed (non-critical)', error);
  }
  throw new PasskeyError('unsupported');
}

/** Decode what is about to be written and open it; only the given password passes. */
async function roundTrip(accountBytes: Bytes, credentialBytes: Bytes, prf: Bytes, password: string): Promise<void> {
  const account: AccountRecord | null = decodeAccountRecord(accountBytes);
  const credential: CredentialRecord | null = decodeCredentialRecord(credentialBytes);
  if (!account || !credential) throw new PasskeyError('failed');
  const binding: CredentialBinding = {
    rpId: credential.rpId, username: credential.username, cid: credential.cid, credentialId: credential.credentialId,
  };
  try {
    const kek: CryptoKey = await deriveKek(prf, binding);
    const dek: CryptoKey = await unwrapDek({ iv: credential.dekIv, ciphertext: credential.wrappedDek }, kek, binding, false);
    const opened: string = await openPassword(
      { iv: account.passwordIv, ciphertext: account.sealedPassword }, dek,
      { rpId: account.rpId, username: account.username, cid: account.cid },
    );
    if (opened !== password) throw new PasskeyError('failed');
  } catch (error) {
    throw error instanceof PasskeyError ? error : new PasskeyError('failed');
  }
}

export async function enrolCredential(deps: PasskeyDeps, req: EnrolRequest): Promise<CredentialRecord> {
  const envelope: Envelope = await openEnvelope(deps, req);
  let account: AccountRecord = envelope.account;
  if (req.password !== null && req.password !== envelope.password) {
    // The password was just verified and the sealed one is stale: re-seal it
    // under the same DEK, so every enrolled key follows.
    const sealed: Sealed = await sealPassword(req.password, envelope.dek, account);
    account = { ...account, passwordIv: sealed.iv, sealedPassword: sealed.ciphertext, updatedAt: deps.now() };
  }
  const password: string = req.password ?? envelope.password;

  const prfSalt: Bytes = randomBytes(32);
  const created: CreatedCredential = await deps.authenticator.create({
    rpId: deps.rpId, rpName: deps.rpName, userHandle: account.userHandle,
    userName: req.username, userDisplayName: req.username, challenge: randomBytes(32),
    excludeCredentialIds: envelope.existing.map((c) => c.credentialId), prfSalt,
  });
  const prf: Bytes = await prfForNewCredential(deps, created, prfSalt);

  const binding: CredentialBinding = { rpId: deps.rpId, username: req.username, cid: account.cid, credentialId: created.credentialId };
  const wrapped: Sealed = await wrapDek(envelope.dek, await deriveKek(prf, binding), binding);
  const credential: CredentialRecord = {
    v: RECORD_VERSION, kind: 'credential', rpId: deps.rpId, username: req.username, cid: account.cid,
    credentialId: created.credentialId, label: req.label, createdAt: deps.now(), lastUsedAt: null,
    transports: created.transports, publicKeySpki: created.publicKeySpki,
    publicKeyAlgorithm: created.publicKeyAlgorithm, attestationObject: created.attestationObject,
    prfSalt, dekIv: wrapped.iv, wrappedDek: wrapped.ciphertext,
  };

  await roundTrip(encodeAccountRecord(account), encodeCredentialRecord(credential), prf, password);
  await saveAccount(deps.store, account);
  await saveCredential(deps.store, credential);
  for (const old of envelope.stale) await deps.store.delete(credentialKey(old.rpId, old.username, old.credentialId));
  return credential;
}
