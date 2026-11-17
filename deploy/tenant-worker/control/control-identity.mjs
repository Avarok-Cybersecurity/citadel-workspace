/**
 * work.avarok.net's own server identity as the "Sign in with Citadel" issuer (sign-in-with-
 * citadel.md §7), beside tenant-identity.mjs: the key from the secret CONTROL_SERVER_KEY_SEED,
 * never generated here (a new key makes every pinned consumer refuse the issuer, which is the
 * visible, correct outcome of losing it); `issued_at` from the var CONTROL_SERVER_KEY_ISSUED_AT,
 * so every isolate serves byte-identical, deterministically signed JSON. One key signs the
 * issuer-only `/.well-known/citadel` and every assertion (server-wasm issuer.rs, the crate's code).
 *
 * Without the seed there is no issuer: the document answers 404, every /sign-in/* route 503
 * `issuer_unavailable`, each with a log line, and nothing is signed.
 */
import { controlWasm } from "./control-wasm.mjs";
import { wellKnownResponse } from "./discovery.mjs";
import { refuse } from "./http.mjs";

/** This isolate's issuer, rebuilt only if the configuration names another key or time. */
let built = null;

const fromHex = (hex) => Uint8Array.from(hex.match(/../g), (b) => parseInt(b, 16));

/**
 * `{domain, origin, document, verifyProof, signAssertion, sha3}` for `cfg`, or null when the seed
 * is not set. `domain` is the issuer's canonical domain (the control host); `origin` the only page
 * origin a proof may name (PUBLIC_ORIGIN).
 */
export function issuerOf(cfg) {
  const { seedHex, issuedAt } = cfg.issuer;
  if (seedHex === null) return null;
  const key = `${cfg.controlHost}\n${issuedAt}\n${seedHex}`;
  if (built?.key !== key) {
    const wasm = controlWasm();
    const identity = new wasm.IssuerIdentity(fromHex(seedHex), cfg.controlHost, BigInt(issuedAt));
    built = { key, wasm, identity, document: identity.well_known() };
  }
  const { wasm, identity, document } = built;
  return {
    domain: cfg.controlHost,
    origin: cfg.publicOrigin,
    document,
    /** `{ok: true, identity_pk}` or `{ok: false, reason, detail}` (the crate's verify_proof). */
    verifyProof: (blob, aud, nonce, challenge) => wasm.verify_sign_in_proof(blob, cfg.controlHost, cfg.publicOrigin, aud, nonce, challenge),
    signAssertion: (identityPk, device, aud, expS, nonce) => identity.sign_assertion(identityPk, device, aud, BigInt(expS), nonce),
    sha3: (bytes) => wasm.sha3_256(bytes),
  };
}

/** Logs why the issuer cannot answer `what`. */
export const issuerMissing = (what) =>
  console.error(`[control] ${what}: CONTROL_SERVER_KEY_SEED is not set; work.avarok.net has no issuer key and signs nothing`);

/** `GET /.well-known/citadel` on the control host. */
export function serveControlWellKnown(cfg) {
  const issuer = issuerOf(cfg);
  if (issuer === null) {
    issuerMissing("/.well-known/citadel");
    return refuse("not-found", "this host publishes no server identity", 404);
  }
  return wellKnownResponse(issuer.document);
}
