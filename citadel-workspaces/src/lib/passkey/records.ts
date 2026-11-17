/**
 * The two passkey records, as they are stored on the agent.
 *
 * CBOR (cbor-x) for the reason every other persisted shape here uses it: the
 * CID is a bigint and CBOR carries one natively. Each record states its version
 * and kind, and a decoder that meets anything else refuses it rather than
 * guessing -- a record it cannot read is treated as absent, which falls back to
 * the password.
 *
 * Nothing in either record is secret on its own: the password is AEAD
 * ciphertext under the DEK, and the DEK is AEAD ciphertext under a KEK that
 * exists only while the authenticator is answering.
 */
import { encode as cborEncode, decode as cborDecode } from 'cbor-x';
import { type Bytes, copyBytes, isBytes } from './bytes';

export const RECORD_VERSION: 1 = 1;

export interface AccountRecord {
  v: typeof RECORD_VERSION;
  kind: 'account';
  rpId: string;
  username: string;
  cid: bigint;
  /** WebAuthn user.id: random, never the username. */
  userHandle: Bytes;
  passwordIv: Bytes;
  sealedPassword: Bytes;
  createdAt: number;
  updatedAt: number;
}

export interface CredentialRecord {
  v: typeof RECORD_VERSION;
  kind: 'credential';
  rpId: string;
  username: string;
  cid: bigint;
  credentialId: Bytes;
  label: string;
  createdAt: number;
  lastUsedAt: number | null;
  transports: string[];
  /**
   * Kept for server-side verification later (option B), so adding it will not
   * need every key enrolled again. SPKI from getPublicKey() where the browser
   * gives one, and the attestation object, which carries the COSE key, always.
   */
  publicKeySpki: Bytes | null;
  publicKeyAlgorithm: number;
  attestationObject: Bytes;
  /** The PRF eval input for this credential: random, one per record. */
  prfSalt: Bytes;
  dekIv: Bytes;
  wrappedDek: Bytes;
}

export function encodeAccountRecord(record: AccountRecord): Bytes {
  return copyBytes(cborEncode(record));
}

export function encodeCredentialRecord(record: CredentialRecord): Bytes {
  return copyBytes(cborEncode(record));
}

type Fields = Record<string, unknown>;

function decodeFields(bytes: Uint8Array): Fields | null {
  try {
    const value: unknown = cborDecode(bytes);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Fields) : null;
  } catch {
    return null;
  }
}

const str = (f: Fields, k: string): string | null => (typeof f[k] === 'string' ? (f[k] as string) : null);
const num = (f: Fields, k: string): number | null => (typeof f[k] === 'number' ? (f[k] as number) : null);
const bin = (f: Fields, k: string): Bytes | null => (isBytes(f[k]) ? copyBytes(f[k] as Uint8Array) : null);
const big = (f: Fields, k: string): bigint | null => (typeof f[k] === 'bigint' ? (f[k] as bigint) : null);

export function decodeAccountRecord(bytes: Uint8Array): AccountRecord | null {
  const f: Fields | null = decodeFields(bytes);
  if (!f || f.v !== RECORD_VERSION || f.kind !== 'account') return null;
  const rpId: string | null = str(f, 'rpId');
  const username: string | null = str(f, 'username');
  const cid: bigint | null = big(f, 'cid');
  const userHandle: Bytes | null = bin(f, 'userHandle');
  const passwordIv: Bytes | null = bin(f, 'passwordIv');
  const sealedPassword: Bytes | null = bin(f, 'sealedPassword');
  const createdAt: number | null = num(f, 'createdAt');
  const updatedAt: number | null = num(f, 'updatedAt');
  if (rpId === null || username === null || cid === null || !userHandle || !passwordIv
    || !sealedPassword || createdAt === null || updatedAt === null) return null;
  return {
    v: RECORD_VERSION, kind: 'account', rpId, username, cid, userHandle,
    passwordIv, sealedPassword, createdAt, updatedAt,
  };
}

export function decodeCredentialRecord(bytes: Uint8Array): CredentialRecord | null {
  const f: Fields | null = decodeFields(bytes);
  if (!f || f.v !== RECORD_VERSION || f.kind !== 'credential') return null;
  const rpId: string | null = str(f, 'rpId');
  const username: string | null = str(f, 'username');
  const cid: bigint | null = big(f, 'cid');
  const credentialId: Bytes | null = bin(f, 'credentialId');
  const label: string | null = str(f, 'label');
  const createdAt: number | null = num(f, 'createdAt');
  const lastUsedAt: number | null = f.lastUsedAt === null ? null : num(f, 'lastUsedAt');
  const transports: unknown = f.transports;
  const publicKeySpki: Bytes | null = f.publicKeySpki === null ? null : bin(f, 'publicKeySpki');
  const publicKeyAlgorithm: number | null = num(f, 'publicKeyAlgorithm');
  const attestationObject: Bytes | null = bin(f, 'attestationObject');
  const prfSalt: Bytes | null = bin(f, 'prfSalt');
  const dekIv: Bytes | null = bin(f, 'dekIv');
  const wrappedDek: Bytes | null = bin(f, 'wrappedDek');
  if (rpId === null || username === null || cid === null || !credentialId || label === null
    || createdAt === null || (f.lastUsedAt !== null && lastUsedAt === null)
    || !Array.isArray(transports) || !transports.every((t) => typeof t === 'string')
    || (f.publicKeySpki !== null && !publicKeySpki) || publicKeyAlgorithm === null
    || !attestationObject || !prfSalt || !dekIv || !wrappedDek) return null;
  return {
    v: RECORD_VERSION, kind: 'credential', rpId, username, cid, credentialId, label,
    createdAt, lastUsedAt, transports: transports as string[], publicKeySpki,
    publicKeyAlgorithm, attestationObject, prfSalt, dekIv, wrappedDek,
  };
}
