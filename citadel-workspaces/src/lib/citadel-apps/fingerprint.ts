/**
 * A publisher key's fingerprint, as the consent screen shows it: the first 16 hex characters of
 * sha256(public key bytes), in groups of four. The same as `citadel_app_signature::fingerprint`,
 * and held to the same fixture (apps/catalogue/fixtures/app-fingerprint-fixtures.json).
 */

/** The ML-DSA-65 verifying key is 1952 bytes. */
const PUBLIC_KEY_BYTES: number = 1952;
const FINGERPRINT_HEX_CHARS: number = 16;

function hexBytes(text: string, length: number): Uint8Array<ArrayBuffer> | null {
  if (text.length !== length * 2 || !/^[0-9a-fA-F]*$/.test(text)) return null;
  const bytes: Uint8Array<ArrayBuffer> = new Uint8Array(length);
  for (let i: number = 0; i < length; i += 1) bytes[i] = parseInt(text.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

/** The fingerprint, or null for a key that is not 3904 hex characters. */
export async function publisherFingerprint(publicKey: string): Promise<string | null> {
  const bytes: Uint8Array<ArrayBuffer> | null = hexBytes(publicKey.trim(), PUBLIC_KEY_BYTES);
  if (bytes === null) return null;
  const digest: ArrayBuffer = await crypto.subtle.digest('SHA-256', bytes);
  const hex: string = [...new Uint8Array(digest)].map((b: number) => b.toString(16).padStart(2, '0')).join('').slice(0, FINGERPRINT_HEX_CHARS);
  return hex.match(/.{4}/g)?.join(' ') ?? null;
}
