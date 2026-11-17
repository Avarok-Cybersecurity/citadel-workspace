/**
 * What this device remembers about an account's sign-in, so the form can
 * offer a key first: never a secret, only who the account is and whether it
 * signs in key-first.
 *
 * Keyed by TENANT and CID. The option-A records were keyed by RP ID and
 * username, and every hosted tenant shares the RP ID `work.avarok.net`, so
 * `alice` on one tenant and `alice` on another were the same record. A CID is
 * permanent for an account and unique on its server; with the tenant beside it
 * the key names exactly one account.
 */
import { encode as cborEncode, decode as cborDecode } from 'cbor-x';
import { type Bytes, copyBytes, toBase64Url, utf8 } from '@/lib/passkey/bytes';
import type { PasskeyStore } from '@/lib/passkey/repository';
import type { AccountRef } from './types';

const ROOT: 'sign-in/v2' = 'sign-in/v2';
const VERSION: 2 = 2;

export interface SignInHint extends AccountRef {
  /** The account's policy is KeyOnly: the form starts with the key, not a password field. */
  keyFirst: boolean;
}

interface StoredHint extends SignInHint { v: typeof VERSION; kind: 'sign-in-hint' }

const tenantPart = (tenant: string): string => toBase64Url(utf8(tenant));
export const hintKey = (tenant: string, cid: bigint): string => `${ROOT}/${tenantPart(tenant)}/${cid.toString()}`;

function decodeHint(bytes: Uint8Array): SignInHint | null {
  let value: unknown;
  try { value = cborDecode(bytes); } catch { return null; }
  if (!value || typeof value !== 'object') return null;
  const f: Partial<StoredHint> = value as Partial<StoredHint>;
  if (f.v !== VERSION || f.kind !== 'sign-in-hint' || typeof f.tenant !== 'string' || typeof f.cid !== 'bigint'
    || typeof f.username !== 'string' || typeof f.keyFirst !== 'boolean') return null;
  return { tenant: f.tenant, cid: f.cid, username: f.username, keyFirst: f.keyFirst };
}

export async function saveHint(store: PasskeyStore, hint: SignInHint): Promise<void> {
  const stored: StoredHint = { v: VERSION, kind: 'sign-in-hint', ...hint };
  await store.set(hintKey(hint.tenant, hint.cid), copyBytes(cborEncode(stored)));
}

export async function deleteHint(store: PasskeyStore, tenant: string, cid: bigint): Promise<void> {
  await store.delete(hintKey(tenant, cid));
}

/** Every account this device can offer a key for. A record under the wrong key is absent. */
export async function listHints(store: PasskeyStore): Promise<SignInHint[]> {
  const keys: string[] = await store.listKeys(`${ROOT}/`);
  const hints: SignInHint[] = [];
  for (const key of keys) {
    const bytes: Bytes | null = await store.get(key);
    const hint: SignInHint | null = bytes ? decodeHint(bytes) : null;
    if (hint && key === hintKey(hint.tenant, hint.cid)) hints.push(hint);
  }
  return hints.sort((a, b) => a.username.localeCompare(b.username) || a.tenant.localeCompare(b.tenant));
}
