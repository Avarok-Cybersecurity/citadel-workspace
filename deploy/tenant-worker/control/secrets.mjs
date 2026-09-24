/**
 * The claim code and what protects it: generation, hashing, and sealing a paid tenant's code
 * until its creator collects it (and its Checkout Session id until its reservation is retried or
 * completed). WebCrypto only.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

export const toHex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

export function fromHex(hex) {
  if (typeof hex !== "string" || hex.length % 2 !== 0 || !/^[0-9a-f]*$/.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** `n` random bytes as hex. The claim code and the reservation token are `randomHex(32)`; ids are `randomHex(16)`. */
export const randomHex = (n) => toHex(crypto.getRandomValues(new Uint8Array(n)));

export const sha256Hex = async (text) => toHex(await crypto.subtle.digest("SHA-256", enc.encode(text)));

/** Equality of two hex digests of equal length without an early exit. */
export function digestsEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * What a sealed value is for, as the key-derivation label: a key derived for one purpose never
 * opens a value sealed for another.
 *   CLAIM_SEAL        a paid tenant's claim code, under its Checkout Session id
 *   RESERVATION_SEAL  a pending tenant's Checkout Session id, under its reservation token
 */
export const CLAIM_SEAL = "citadel-claim-seal-v1";
export const RESERVATION_SEAL = "citadel-reservation-seal-v1";
const SEAL_PURPOSES = new Set([CLAIM_SEAL, RESERVATION_SEAL]);

async function sealKey(purpose, secret) {
  if (!SEAL_PURPOSES.has(purpose)) throw new Error(`no such seal purpose: ${purpose}`);
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(`${purpose}\0${secret}`));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** `iv:ciphertext` in hex, readable only by whoever holds `secret`, for `purpose` only. */
export async function seal(purpose, secret, plaintext, aad) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: enc.encode(aad) },
    await sealKey(purpose, secret),
    enc.encode(plaintext),
  );
  return `${toHex(iv)}:${toHex(sealed)}`;
}

/** The plaintext, or null when the secret, the purpose or the associated data is not the one it was sealed with. */
export async function unseal(purpose, secret, sealed, aad) {
  const [ivHex, ctHex] = String(sealed).split(":");
  const iv = fromHex(ivHex);
  const ct = fromHex(ctHex);
  if (!iv || !ct) return null;
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: enc.encode(aad) },
      await sealKey(purpose, secret),
      ct,
    );
    return dec.decode(plain);
  } catch {
    return null;
  }
}
