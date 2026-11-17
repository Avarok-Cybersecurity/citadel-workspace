/**
 * Retiring option A (a password sealed on the agent under a passkey's PRF).
 *
 * Old records are still READ -- signInWithPasskey opens them -- but only so the
 * user can sign in once more and move to a key the server verifies. Nothing
 * here or anywhere else seals a password again.
 *
 * Deletion checks the CID. Option-A records are keyed by RP ID and username,
 * which every hosted tenant shares, so a record found under `alice` may belong
 * to another tenant's alice. Only the record that names the account that just
 * signed in is removed.
 */
import type { AccountRecord, CredentialRecord } from '@/lib/passkey/records';
import {
  type PasskeyStore, accountKey, credentialKey, listCredentials, loadAccount,
} from '@/lib/passkey/repository';

/** The sealed-password record for this signed-in account, if it is this account's. */
export async function legacyRecordFor(
  store: PasskeyStore, rpId: string, username: string, cid: bigint,
): Promise<AccountRecord | null> {
  const record: AccountRecord | null = await loadAccount(store, rpId, username);
  return record && record.cid === cid ? record : null;
}

/** Delete the sealed password and every key bound to it. Returns how many records went. */
export async function retireLegacyRecords(
  store: PasskeyStore, rpId: string, username: string, cid: bigint,
): Promise<number> {
  const record: AccountRecord | null = await legacyRecordFor(store, rpId, username, cid);
  if (!record) return 0;
  const keys: CredentialRecord[] = await listCredentials(store, rpId, username);
  let removed: number = 0;
  for (const key of keys) {
    if (key.cid !== cid) continue;
    await store.delete(credentialKey(rpId, username, key.credentialId));
    removed += 1;
  }
  await store.delete(accountKey(rpId, username));
  return removed + 1;
}
