/**
 * Encryption at rest for the records this device keeps of an account's documents. Pure
 * WebCrypto, no I/O.
 *
 * It protects the copies of an account's documents this browser stores, so someone holding
 * only this browser's data cannot read them. It is not a substitute for full-disk encryption.
 *
 *   root (32 random bytes, one per account, never stored beside the records)
 *     --HKDF-SHA-256(salt = SHA-256("citadel/cdoc-at-rest|<account>"),
 *                    info = "citadel/cdoc-at-rest/record-format/v1")-->
 *   record key (AES-256-GCM, non-extractable, encrypt/decrypt only)
 *
 * The salt is derived, not stored. HKDF's salt adds separation when the input could repeat
 * across uses; here the input is a fresh 32-byte random root per account, so a stored random
 * salt would add nothing the root does not already give, and the account in the derived salt
 * keeps two accounts' keys apart even if one root were ever reused.
 *
 * Every write seals the value's CBOR (cbor-x: bigints and byte arrays round-trip) with a fresh
 * 96-bit random nonce, never one per record, and additional data naming the format version,
 * the account, the node and the record's kind, so a sealed record moved to another key fails
 * its tag. Symmetric primitives only.
 */
import { decode as cborDecode, encode as cborEncode } from 'cbor-x';
import type { AtRestEnvelope } from './at-rest-shape';

export const AT_REST_ROOT_BYTES: 32 = 32;
const GCM_IV_BYTES: 12 = 12;
const FORMAT: string = 'citadel/cdoc-at-rest/record-format/v1';
// Named once: the algorithms are security parameters, not strings to retype.
const AES_GCM: 'AES-GCM' = 'AES-GCM';
const HKDF: 'HKDF' = 'HKDF';
/** Bytes WebCrypto takes: backed by an ArrayBuffer (a stored or decoded view is copied into one). */
type Bytes = Uint8Array<ArrayBuffer>;
const utf8 = (text: string): Bytes => new TextEncoder().encode(text);
const own = (view: Uint8Array): Bytes => new Uint8Array(view);

/**
 * The value with every byte view as this realm's Uint8Array: cbor-x tells bytes from arrays by
 * instanceof, which is false for a view made in another realm (a worker, WASM glue, jsdom).
 */
function sameRealmBytes(value: unknown): unknown {
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  if (Array.isArray(value)) return value.map(sameRealmBytes);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(Object.entries(value).map(([k, v]: [string, unknown]): [string, unknown] => [k, sameRealmBytes(v)]));
}

/** Opening failed: wrong key, a record moved to another key, or bytes changed. Which, is not said. */
export class SealedRecordError extends Error {
  constructor() {
    super('the sealed record did not open');
    this.name = 'SealedRecordError';
  }
}

export function newRoot(): Bytes {
  return crypto.getRandomValues(new Uint8Array(AT_REST_ROOT_BYTES));
}

export async function deriveRecordKey(root: Uint8Array, account: bigint): Promise<CryptoKey> {
  if (root.byteLength !== AT_REST_ROOT_BYTES) throw new Error('the encryption root is not 32 bytes');
  const salt: ArrayBuffer = await crypto.subtle.digest('SHA-256', utf8(`citadel/cdoc-at-rest|${account.toString()}`));
  const raw: Bytes = own(root);
  let ikm: CryptoKey;
  try {
    ikm = await crypto.subtle.importKey('raw', raw, HKDF, false, ['deriveKey']);
  } finally {
    raw.fill(0);
  }
  return crypto.subtle.deriveKey({ name: HKDF, hash: 'SHA-256', salt, info: utf8(FORMAT) }, ikm, { name: AES_GCM, length: 256 }, false, ['encrypt', 'decrypt']);
}

/** The additional data binding a sealed value to where it is kept. */
export function recordAad(account: bigint, node: string, kind: string): Bytes {
  return utf8(`v1|${account.toString()}|${node}|${kind}`);
}

export async function sealValue(key: CryptoKey, aad: Bytes, value: unknown): Promise<AtRestEnvelope> {
  const iv: Bytes = crypto.getRandomValues(new Uint8Array(GCM_IV_BYTES));
  const ct: ArrayBuffer = await crypto.subtle.encrypt({ name: AES_GCM, iv, additionalData: aad }, key, own(cborEncode(sameRealmBytes(value))));
  return { atRest: 1, iv, ct: new Uint8Array(ct) };
}

export async function openValue(key: CryptoKey, aad: Bytes, envelope: AtRestEnvelope): Promise<unknown> {
  if (envelope.iv.byteLength !== GCM_IV_BYTES) throw new SealedRecordError();
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: AES_GCM, iv: own(envelope.iv), additionalData: aad }, key, own(envelope.ct));
  } catch {
    throw new SealedRecordError();
  }
  return cborDecode(new Uint8Array(plain));
}

/** Whether two stored values are the same value, by their CBOR: what a sweep checks before replacing. */
export function sameValue(a: unknown, b: unknown): boolean {
  const x: Uint8Array = cborEncode(sameRealmBytes(a));
  const y: Uint8Array = cborEncode(sameRealmBytes(b));
  return x.byteLength === y.byteLength && x.every((byte: number, i: number): boolean => byte === y[i]);
}
