/**
 * The browser's memory that it joined a session another window holds.
 *
 * A password `AttachSession` earns a token from the agent (agent 0.8.6,
 * kernel/attach_tokens.rs): presented later it attaches this browser again
 * without the password, for as long as the session lives. It is a credential,
 * so it is never stored as plaintext: it is sealed with AES-GCM under a key
 * generated here as NON-extractable, which IndexedDB keeps as an opaque
 * CryptoKey. Script on this origin can use the key, but nothing can read it
 * out, copy it to another browser or recover the token from a disk image of
 * the database alone. The session's cid is bound in as additional data, so a
 * sealed token cannot be replayed as another session's.
 */
import { dbGet, dbPut, dbDelete } from '../storage-utils';

/** Where sealed tokens and their key live; IndexedDB in the browser. */
export interface JoinTokenStorage {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

interface SealedToken { iv: Uint8Array<ArrayBuffer>; sealed: ArrayBuffer }

const KEY_ID: string = 'multi-window:join-key';
const tokenId = (cid: bigint): string => `multi-window:join-token:${cid.toString()}`;
const boundTo = (cid: bigint): Uint8Array<ArrayBuffer> => new TextEncoder().encode(`citadel-join:${cid.toString()}`);
const IV_BYTES: number = 12;
const AES_GCM: 'AES-GCM' = 'AES-GCM';

// Structural, not instanceof: a value read back from IndexedDB, a worker or a
// test realm is not an instance of this realm's classes.
function isSealed(value: unknown): value is SealedToken {
  const v: Partial<SealedToken> = (value ?? {}) as Partial<SealedToken>;
  return ArrayBuffer.isView(v.iv) && Object.prototype.toString.call(v.sealed) === '[object ArrayBuffer]';
}

function isKey(value: unknown): value is CryptoKey {
  return Object.prototype.toString.call(value) === '[object CryptoKey]';
}

async function sealingKey(storage: JoinTokenStorage): Promise<CryptoKey> {
  const held: unknown = await storage.get(KEY_ID);
  if (isKey(held)) return held;
  const key: CryptoKey = await crypto.subtle.generateKey({ name: AES_GCM, length: 256 }, false, ['encrypt', 'decrypt']);
  await storage.put(KEY_ID, key);
  return key;
}

export async function rememberJoin(storage: JoinTokenStorage, cid: bigint, token: Uint8Array): Promise<void> {
  const key: CryptoKey = await sealingKey(storage);
  const iv: Uint8Array<ArrayBuffer> = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed: ArrayBuffer = await crypto.subtle.encrypt({ name: AES_GCM, iv, additionalData: boundTo(cid) }, key, Uint8Array.from(token));
  const record: SealedToken = { iv, sealed };
  await storage.put(tokenId(cid), record);
}

/** The token this browser earned for `cid`, or null; one that will not open is forgotten. */
export async function recallJoin(storage: JoinTokenStorage, cid: bigint): Promise<Uint8Array | null> {
  const record: unknown = await storage.get(tokenId(cid));
  const key: unknown = await storage.get(KEY_ID);
  if (!isSealed(record) || !isKey(key)) return null;
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: AES_GCM, iv: record.iv, additionalData: boundTo(cid) }, key, record.sealed));
  } catch {
    await forgetJoin(storage, cid);
    return null;
  }
}

export async function forgetJoin(storage: JoinTokenStorage, cid: bigint): Promise<void> {
  await storage.delete(tokenId(cid));
}

export const browserJoinTokens: JoinTokenStorage = {
  get: (key: string): Promise<unknown> => dbGet<unknown>('keyValue', key),
  put: (key: string, value: unknown): Promise<void> => dbPut('keyValue', key, value),
  delete: (key: string): Promise<void> => dbDelete('keyValue', key),
};
