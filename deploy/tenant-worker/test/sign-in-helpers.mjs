/**
 * Shared by the "Sign in with Citadel" tests: C0's schema, fixtures and known answers
 * (vitest.config.mjs CONTRACT_SIGN_IN), and the issuer driven with the contract's own randomness
 * and clock. The handlers are the production ones; only `io.random` and `io.now` are fixed, so a
 * run reproduces the contract's vectors byte for byte.
 */
import { env, SELF } from "cloudflare:test";
import { config } from "../control/http.mjs";
import { ioFor } from "../control/dispatch.mjs";
import { issuerOf } from "../control/control-identity.mjs";
import { CODE_ALPHABET } from "../control/sign-in-code.mjs";
import { violation } from "./json-schema.mjs";

export const SIGN_IN = JSON.parse(env.CONTRACT_SIGN_IN);
export const KAT = SIGN_IN.kat;
export const signInFixture = (path) => JSON.parse(SIGN_IN.fixtures[path]);
/** The first way `value` breaks the schema's `$defs[def]`, or null. */
export const breaks = (def, value) => violation(SIGN_IN.defs[def], value);

export const CFG = config(env);
export const issuer = () => issuerOf(CFG);

export const fromHex = (hex) => Uint8Array.from(hex.match(/../g), (b) => parseInt(b, 16));
export const b64 = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

/** The 5 random bytes that spell `code` (the inverse of sign-in-code.mjs codeOf). */
export function codeBytes(code) {
  let bits = 0n;
  for (const symbol of code.replace("-", "")) bits = (bits << 5n) | BigInt(CODE_ALPHABET.indexOf(symbol));
  return Uint8Array.from({ length: 5 }, (_, i) => Number((bits >> BigInt(8 * (4 - i))) & 0xffn));
}

/**
 * The control plane's io with a clock the test moves (`clock.now`) and a CSPRNG that hands out
 * `queue` first (each entry must be the length asked for) and real randomness after it.
 */
export function katIo(clock, queue = []) {
  const pending = [...queue];
  return {
    ...ioFor(env),
    now: () => clock.now,
    random: (n) => {
      const next = pending.shift();
      if (next === undefined) return crypto.getRandomValues(new Uint8Array(n));
      if (next.length !== n) throw new Error(`the test queued ${next.length} random bytes where ${n} were drawn`);
      return next;
    },
  };
}

/** The contract's link for `client`, as a begin request, with `overrides`. */
export const beginBody = (overrides = {}) => ({ ...signInFixture("SignInBeginRequest/valid.json"), ...overrides });
export const KAT_NONCE = fromHex(KAT.attempt.nonce_hex);
export const KAT_PROOF = KAT.proof.blob_b64url;
export const KAT_DEVICE = KAT.device.value;
export const KAT_VERIFIER = b64(fromHex(KAT.verifier_hex));
export const BROWSER_RETURN = "https://synchronized.work/auth/return";

/** Response bodies as `{status, body}`. */
export const read = async (response) => ({ status: response.status, body: await response.json() });

/** The proof blob with identity B's key in place of identity A's, A's signature kept. */
export function proofWithKeyB() {
  const blob = unb64(KAT_PROOF);
  const body = fromHex(KAT.proof.body_hex);
  const keyAt = 1 + body.length - 1952;
  blob.set(unb64(SIGN_IN.identityB), keyAt);
  return b64(blob);
}

/** The proof body under the cross-role (binding-domain) signature. */
export const crossRoleProof = () => {
  const sig = KAT.proof_must_fail.find((c) => c.case.startsWith("cross-role")).sig_hex;
  return b64(Uint8Array.of(1, ...fromHex(KAT.proof.body_hex), ...fromHex(sig)));
};

/** A POST as the control plane's own page sends it. */
export const pagePost = (path, body) =>
  SELF.fetch(`https://${CFG.controlHost}${path}`, {
    method: "POST",
    headers: { origin: CFG.publicOrigin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
