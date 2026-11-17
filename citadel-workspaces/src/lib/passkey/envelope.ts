/**
 * The passkey envelope: pure WebCrypto, no I/O.
 *
 *   PRF output (32 bytes, from the authenticator after user verification)
 *     --HKDF-SHA-256(fixed versioned salt, info bound to rpId|credId|cid|user)-->
 *   KEK (AES-GCM-256, non-extractable, wrapKey/unwrapKey only)
 *     --wraps--> DEK (random AES-GCM-256, one per account)
 *                  --encrypts--> the account password
 *
 * Every AES-GCM operation takes a fresh random 96-bit IV and additional data
 * naming the account and, for the DEK wrap, the credential. A record moved to
 * another account or another credential fails its tag rather than decrypting.
 *
 * A failure here says only "this did not open". Which step failed is not
 * reported, because the UI must not distinguish them either.
 */
import { type Bytes, randomBytes, toBase64Url, utf8, fromUtf8 } from './bytes';

export const ENVELOPE_VERSION: 1 = 1;
export const PRF_OUTPUT_BYTES: 32 = 32;
export const GCM_IV_BYTES: 12 = 12;

// Named once: the algorithm is a security parameter, not a string to retype.
const AES_GCM: 'AES-GCM' = 'AES-GCM';
const HKDF: 'HKDF' = 'HKDF';

const DOMAIN: string = `citadel/passkey-unlock/v${ENVELOPE_VERSION}`;
/** Fixed and versioned: per-record uniqueness comes from the PRF eval salt. */
const HKDF_SALT: Bytes = utf8(`${DOMAIN}/hkdf-salt`);

/** Which account a sealed password belongs to. */
export interface AccountBinding {
  rpId: string;
  username: string;
  cid: bigint;
}

/** Which credential a wrapped DEK belongs to. */
export interface CredentialBinding extends AccountBinding {
  credentialId: Bytes;
}

export class EnvelopeError extends Error {
  constructor() {
    super('The passkey envelope could not be opened');
    this.name = 'EnvelopeError';
  }
}

export interface Sealed {
  iv: Bytes;
  ciphertext: Bytes;
}

// Usernames are base64url'd so no username can forge a field separator.
const accountLabel = (b: AccountBinding): string =>
  `${b.rpId}|${b.cid.toString()}|${toBase64Url(utf8(b.username))}`;
const credentialLabel = (b: CredentialBinding): string =>
  `${accountLabel(b)}|${toBase64Url(b.credentialId)}`;

const kekInfo = (b: CredentialBinding): Bytes => utf8(`${DOMAIN}|kek|${credentialLabel(b)}`);
const dekAad = (b: CredentialBinding): Bytes => utf8(`${DOMAIN}|dek|${credentialLabel(b)}`);
const passwordAad = (b: AccountBinding): Bytes => utf8(`${DOMAIN}|password|${accountLabel(b)}`);

async function orEnvelopeError<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch {
    throw new EnvelopeError();
  }
}

function requireIv(iv: Bytes): void {
  if (iv.byteLength !== GCM_IV_BYTES) throw new EnvelopeError();
}

/** HKDF-SHA-256 from the PRF output to a non-extractable AES-GCM-256 KEK. */
export async function deriveKek(prfOutput: Bytes, binding: CredentialBinding): Promise<CryptoKey> {
  if (prfOutput.byteLength !== PRF_OUTPUT_BYTES) throw new EnvelopeError();
  const ikm: CryptoKey = await crypto.subtle.importKey('raw', prfOutput, HKDF, false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: HKDF, hash: 'SHA-256', salt: HKDF_SALT, info: kekInfo(binding) },
    ikm,
    { name: AES_GCM, length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  );
}

/** A fresh account data key. Extractable only so a KEK can wrap it. */
export async function generateDek(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: AES_GCM, length: 256 }, true, ['encrypt', 'decrypt']);
}

export async function wrapDek(dek: CryptoKey, kek: CryptoKey, binding: CredentialBinding): Promise<Sealed> {
  const iv: Bytes = randomBytes(GCM_IV_BYTES);
  const wrapped: ArrayBuffer = await crypto.subtle.wrapKey(
    'raw', dek, kek, { name: AES_GCM, iv, additionalData: dekAad(binding) },
  );
  return { iv, ciphertext: new Uint8Array(wrapped) };
}

/**
 * `extractable` is the caller's decision: sign-in needs only to decrypt, while
 * adding another key needs to wrap the same DEK again.
 */
export async function unwrapDek(
  sealed: Sealed, kek: CryptoKey, binding: CredentialBinding, extractable: boolean,
): Promise<CryptoKey> {
  requireIv(sealed.iv);
  return orEnvelopeError(() => crypto.subtle.unwrapKey(
    'raw', sealed.ciphertext, kek,
    { name: AES_GCM, iv: sealed.iv, additionalData: dekAad(binding) },
    { name: AES_GCM, length: 256 }, extractable, ['encrypt', 'decrypt'],
  ));
}

export async function sealPassword(password: string, dek: CryptoKey, binding: AccountBinding): Promise<Sealed> {
  const iv: Bytes = randomBytes(GCM_IV_BYTES);
  const ciphertext: ArrayBuffer = await crypto.subtle.encrypt(
    { name: AES_GCM, iv, additionalData: passwordAad(binding) }, dek, utf8(password),
  );
  return { iv, ciphertext: new Uint8Array(ciphertext) };
}

export async function openPassword(sealed: Sealed, dek: CryptoKey, binding: AccountBinding): Promise<string> {
  requireIv(sealed.iv);
  return orEnvelopeError(async () => fromUtf8(new Uint8Array(await crypto.subtle.decrypt(
    { name: AES_GCM, iv: sealed.iv, additionalData: passwordAad(binding) }, dek, sealed.ciphertext,
  ))));
}
