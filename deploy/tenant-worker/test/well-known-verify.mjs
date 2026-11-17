/**
 * An independent check of a /.well-known/citadel document, in JavaScript (noble's FIPS 204
 * ML-DSA-65), not the Rust that signed it: the server key a seed derives (identity-api.md §6:
 * xi = HMAC-SHA3-256(seed, "citadel-server-sign-v1"), then ML-DSA-65 keygen), the signed message
 * (`"citadel-well-known-v1" ‖ 0x00 ‖` RFC 8949 §4.2.1 deterministic CBOR of the document without
 * `sig`) and the signature over it. Proven against C0's known answers before it judges the Worker.
 */
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha3_256 } from "@noble/hashes/sha3.js";

const utf8 = (s) => new TextEncoder().encode(s);
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

function head(major, n) {
  const m = major << 5;
  if (n < 24) return Uint8Array.of(m | n);
  if (n < 0x100) return Uint8Array.of(m | 24, n);
  if (n < 0x10000) return Uint8Array.of(m | 25, n >> 8, n & 0xff);
  if (n < 0x100000000) return Uint8Array.of(m | 26, n >>> 24, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff);
  throw new Error("a CBOR length or integer this large is not needed here");
}

/** Deterministic CBOR of unsigned integers, text, arrays and maps with text keys. */
export function cbor(value) {
  if (Number.isInteger(value) && value >= 0) return head(0, value);
  if (typeof value === "string") {
    const bytes = utf8(value);
    return concat(head(3, bytes.length), bytes);
  }
  if (Array.isArray(value)) return concat(head(4, value.length), ...value.map(cbor));
  if (value && typeof value === "object") {
    const entries = Object.entries(value).map(([k, v]) => [cbor(k), cbor(v)]);
    const lexicographic = (a, b) => {
      for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
      return a.length - b.length;
    };
    entries.sort(([a], [b]) => lexicographic(a, b));
    return concat(head(5, entries.length), ...entries.flat());
  }
  throw new Error(`not encodable here: ${JSON.stringify(value)}`);
}

/** The CBOR the document's signature covers: every field but `sig`. */
export function signedCbor(doc) {
  const { sig: _sig, ...unsigned } = doc;
  return cbor(unsigned);
}

/** The ML-DSA-65 public key the server key seed `seed` (32 bytes) derives. */
export function serverPublicKey(seed) {
  return ml_dsa65.keygen(hmac(sha3_256, seed, utf8("citadel-server-sign-v1"))).publicKey;
}

const b64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

/** Whether `doc`'s signature verifies under `publicKey`. */
export function signatureVerifies(doc, publicKey) {
  const message = concat(utf8("citadel-well-known-v1"), Uint8Array.of(0), signedCbor(doc));
  return ml_dsa65.verify(b64url(doc.sig), message, publicKey);
}

export const toHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
export const fromHex = (hex) => Uint8Array.from(hex.match(/../g), (b) => parseInt(b, 16));
export const publicKeyOf = (doc) => b64url(doc.server_key.pk);
