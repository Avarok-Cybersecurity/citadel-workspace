/**
 * The encodings "Sign in with Citadel" puts on the wire: unpadded base64url (the link's challenge
 * and state, attempts, nonces, proofs, assertions) and the one-time code (sign-in-with-citadel.md
 * §4): eight symbols of a 32-symbol alphabet with no I, L, O or U, 40 random bits, always
 * `XXXX-XXXX` on the wire.
 */

export const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** 40 bits: eight 5-bit symbols. */
export const CODE_RANDOM_BYTES = 5;
export const CODE_SHAPE = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{4}-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{4}$/;

const B64URL_SHAPE = /^[A-Za-z0-9_-]*$/;

export function toBase64url(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The bytes of unpadded base64url `text`, or null when it is not that (padding, other symbols, a dangling symbol). */
export function fromBase64url(text) {
  if (typeof text !== "string" || !B64URL_SHAPE.test(text) || text.length % 4 === 1) return null;
  const bytes = Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  // Only the canonical spelling: trailing bits that encode nothing must be zero.
  return toBase64url(bytes) === text ? bytes : null;
}

/** The bytes of `text` when it is base64url of exactly `length` bytes, else null. */
export function exactBytes(text, length) {
  const bytes = fromBase64url(text);
  return bytes !== null && bytes.length === length ? bytes : null;
}

/** The code `random` (CODE_RANDOM_BYTES bytes) spells, big-endian, as `XXXX-XXXX`. */
export function codeOf(random) {
  if (random.length !== CODE_RANDOM_BYTES) throw new Error(`a code is ${CODE_RANDOM_BYTES} random bytes`);
  let bits = 0n;
  for (const b of random) bits = (bits << 8n) | BigInt(b);
  let symbols = "";
  for (let i = 7; i >= 0; i--) symbols += CODE_ALPHABET[Number((bits >> BigInt(5 * i)) & 31n)];
  return `${symbols.slice(0, 4)}-${symbols.slice(4)}`;
}

export const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/** Constant-time equality of two byte arrays of the same length. */
export function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
