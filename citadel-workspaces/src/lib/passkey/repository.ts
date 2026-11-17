/**
 * Where passkey records live, behind a port.
 *
 * `PasskeyStore` is the I/O boundary (SBIO): production writes the agent's
 * CID-0 LocalDB, which any local process can read -- acceptable only because
 * every byte written through here is ciphertext or public metadata. Tests use
 * an in-memory store.
 *
 * Keys carry the RP ID, because a credential made on localhost cannot sign in
 * on work.avarok.net and the two must not be offered for each other.
 */
import { type Bytes, toBase64Url, utf8 } from './bytes';
import {
  type AccountRecord, type CredentialRecord,
  decodeAccountRecord, decodeCredentialRecord, encodeAccountRecord, encodeCredentialRecord,
} from './records';

export interface PasskeyStore {
  /** null when the key is genuinely absent; a failed read rejects. */
  get(key: string): Promise<Bytes | null>;
  set(key: string, value: Bytes): Promise<void>;
  delete(key: string): Promise<void>;
  listKeys(prefix: string): Promise<string[]>;
}

const ROOT: string = 'passkey-login/v1';
const userKey = (username: string): string => toBase64Url(utf8(username));

export const accountKey = (rpId: string, username: string): string =>
  `${ROOT}/${rpId}/account/${userKey(username)}`;
export const credentialPrefix = (rpId: string, username: string): string =>
  `${ROOT}/${rpId}/cred/${userKey(username)}/`;
export const credentialKey = (rpId: string, username: string, credentialId: Uint8Array): string =>
  `${credentialPrefix(rpId, username)}${toBase64Url(credentialId)}`;

/** A record that does not decode, or names another account, is absent. */
export async function loadAccount(store: PasskeyStore, rpId: string, username: string): Promise<AccountRecord | null> {
  const bytes: Bytes | null = await store.get(accountKey(rpId, username));
  const record: AccountRecord | null = bytes ? decodeAccountRecord(bytes) : null;
  return record && record.rpId === rpId && record.username === username ? record : null;
}

export async function listCredentials(store: PasskeyStore, rpId: string, username: string): Promise<CredentialRecord[]> {
  const keys: string[] = await store.listKeys(credentialPrefix(rpId, username));
  const records: CredentialRecord[] = [];
  for (const key of keys) {
    const bytes: Bytes | null = await store.get(key);
    const record: CredentialRecord | null = bytes ? decodeCredentialRecord(bytes) : null;
    if (record && record.rpId === rpId && record.username === username
      && key === credentialKey(rpId, username, record.credentialId)) records.push(record);
  }
  return records.sort((a, b) => a.createdAt - b.createdAt);
}

export async function saveAccount(store: PasskeyStore, record: AccountRecord): Promise<void> {
  await store.set(accountKey(record.rpId, record.username), encodeAccountRecord(record));
}

export async function saveCredential(store: PasskeyStore, record: CredentialRecord): Promise<void> {
  await store.set(credentialKey(record.rpId, record.username, record.credentialId), encodeCredentialRecord(record));
}

/** Removing the last key removes the sealed password with it. */
export async function removeCredential(
  store: PasskeyStore, rpId: string, username: string, credentialId: Uint8Array,
): Promise<void> {
  await store.delete(credentialKey(rpId, username, credentialId));
  const remaining: CredentialRecord[] = await listCredentials(store, rpId, username);
  if (remaining.length === 0) await store.delete(accountKey(rpId, username));
}

/** Whether this account can be offered "Use passkey or security key" here. */
export async function hasPasskeyLogin(store: PasskeyStore, rpId: string, username: string): Promise<boolean> {
  if (!(await loadAccount(store, rpId, username))) return false;
  return (await listCredentials(store, rpId, username)).length > 0;
}

/**
 * Every account with a working passkey here, for this page's RP ID, so the
 * sign-in form can offer one before a username is typed.
 */
export async function listPasskeyAccounts(store: PasskeyStore, rpId: string): Promise<string[]> {
  const keys: string[] = await store.listKeys(`${ROOT}/${rpId}/account/`);
  const names: string[] = [];
  for (const key of keys) {
    const bytes: Bytes | null = await store.get(key);
    const record: AccountRecord | null = bytes ? decodeAccountRecord(bytes) : null;
    if (!record || record.rpId !== rpId || key !== accountKey(rpId, record.username)) continue;
    if ((await listCredentials(store, rpId, record.username)).length > 0) names.push(record.username);
  }
  return names.sort((a, b) => a.localeCompare(b));
}
