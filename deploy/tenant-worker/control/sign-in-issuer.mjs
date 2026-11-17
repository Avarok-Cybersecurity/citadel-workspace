/**
 * "Sign in with Citadel", the issuer's decisions (sign-in-with-citadel.md §1, §1a, §4): begin an
 * attempt, accept the agent's identity proof for it, and exchange the one-time code and verifier
 * for an assertion signed with work.avarok.net's server key (control-identity.mjs). No I/O of its
 * own: the clock, the CSPRNG and the store are `io`'s (`now`, `random`, `signIn`), the crypto is
 * the issuer's (the crate's, through server-wasm).
 *
 * The subject of every assertion is the key a proof proved: nothing else ever reaches a code's
 * record, and the issuer keeps no identity registry. Each refusal is HTTP 400 with the contract's
 * reason code as `error`.
 */
import { json, refuse } from "./http.mjs";
import { clientOf, returnAllowed } from "./sign-in-clients.mjs";
import { CODE_RANDOM_BYTES, CODE_SHAPE, codeOf, exactBytes, fromBase64url, sameBytes, toBase64url, toHex } from "./sign-in-code.mjs";

/** Contract constants (sign-in-kat.json `proof_constants`, `code`; identity-api.md §7). */
export const ATTEMPT_TTL_S = 300;
export const MAX_PROOF_FAILURES = 5;
export const CODE_TTL_S = 600;
export const MAX_CODE_FAILURES = 5;
export const ASSERTION_TTL_S = 30 * 24 * 3600;
/** How long a record is kept past its TTL, so a late request is told "expired", not "unknown". */
export const RECORD_RETAIN_S = 3600;
const ATTEMPT_BYTES = 16;
const NONCE_BYTES = 32;

const CLIENT_SHAPE = /^[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/;
const STATE_SHAPE = /^[A-Za-z0-9_-]{22,43}$/;
const ATTEMPT_SHAPE = /^[A-Za-z0-9_-]{22,43}$/;
const DEVICE_SHAPE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?#[A-Za-z0-9_-]{43}$/;

const no = (reason, detail) => refuse(reason, detail, 400);

/** Whether `body` has exactly the fields `names` and `v: 1`. */
function exactly(body, names) {
  const keys = Object.keys(body);
  return body.v === 1 && keys.length === names.length && names.every((n) => Object.hasOwn(body, n));
}

/** `POST /sign-in/begin`: the link re-validated, then an attempt drawn for `ATTEMPT_TTL_S`. */
export async function beginSignIn(io, issuer, body) {
  if (!exactly(body, ["v", "client", "challenge", "state", "return"])) return no("malformed_link", "the body is {v: 1, client, challenge, state, return}");
  const { client: id, challenge, state } = body;
  if (typeof id !== "string" || !CLIENT_SHAPE.test(id) || exactBytes(challenge, 32) === null || typeof state !== "string" || !STATE_SHAPE.test(state)) {
    return no("malformed_link", "client, challenge or state is not of its shape");
  }
  const client = clientOf(id);
  if (client === null) return no("unknown_client", "no such client is registered");
  if (!returnAllowed(client, body.return)) return no("return_not_allowlisted", "that return is not allowlisted for this client");
  const now = io.now();
  const attempt = toBase64url(io.random(ATTEMPT_BYTES));
  const nonce = toBase64url(io.random(NONCE_BYTES));
  await io.signIn.addAttempt(
    { attempt, nonce, client: id, aud: client.aud, challenge, return_url: body.return, state, created_at: now },
    now - ATTEMPT_TTL_S - RECORD_RETAIN_S,
  );
  return json({ v: 1, attempt, nonce, issuer: issuer.domain, aud: client.aud, display_name: client.display_name, expires_in_s: ATTEMPT_TTL_S });
}

/** `POST /sign-in/prove`: the attempt's checks, then the proof's (the crate's verify_proof), then a code. */
export async function proveSignIn(io, issuer, body) {
  if (!exactly(body, ["v", "attempt", "proof"]) || typeof body.attempt !== "string" || !ATTEMPT_SHAPE.test(body.attempt)) {
    return no("unknown_attempt", "the body is {v: 1, attempt, proof} naming an attempt");
  }
  const row = await io.signIn.attempt(body.attempt);
  if (row === null) return no("unknown_attempt", "no such sign-in attempt (or it was burnt)");
  const now = io.now();
  if (now - row.created_at > ATTEMPT_TTL_S) return no("attempt_expired", "this sign-in attempt has expired; start again");
  if (row.proven === 1) return no("attempt_proven", "this sign-in attempt has already been proven");

  const blob = fromBase64url(body.proof);
  const verified = blob === null
    ? { ok: false, reason: "malformed_proof", detail: "the proof is not base64url" }
    : issuer.verifyProof(blob, row.aud, fromBase64url(row.nonce), fromBase64url(row.challenge));
  if (!verified.ok) {
    await io.signIn.attemptFailed(row.attempt, MAX_PROOF_FAILURES);
    return no(verified.reason, verified.detail);
  }
  if (!(await io.signIn.markProven(row.attempt))) return no("attempt_proven", "this sign-in attempt has already been proven");

  const code = codeOf(io.random(CODE_RANDOM_BYTES));
  await io.signIn.addCode(
    { code_hash: codeHash(issuer, code), challenge: row.challenge, aud: row.aud, identity_pk: toBase64url(verified.identity_pk), issued_at: now },
    now - CODE_TTL_S - RECORD_RETAIN_S,
  );
  return json({ v: 1, code, return: row.return_url, state: row.state });
}

/** A code's at-rest key: SHA3-256 of its wire form, so the table holds no usable code. */
const codeHash = (issuer, code) => toHex(issuer.sha3(new TextEncoder().encode(code)));

/** `POST /sign-in/complete`: code and verifier for the assertion over the proven identity. */
export async function completeSignIn(io, issuer, body) {
  if (!exactly(body, ["v", "client", "code", "verifier", "device"])) return no("malformed_request", "the body is {v: 1, client, code, verifier, device}");
  const { client: id, code, device } = body;
  const verifier = exactBytes(body.verifier, 32);
  if (typeof code !== "string" || !CODE_SHAPE.test(code) || verifier === null || typeof device !== "string" || !DEVICE_SHAPE.test(device)) {
    return no("malformed_request", "code, verifier or device is not of its shape");
  }
  const client = typeof id === "string" ? clientOf(id) : null;
  if (client === null) return no("unknown_client", "no such client is registered");
  const key = codeHash(issuer, code);
  const row = await io.signIn.code(key);
  if (row === null) return no("unknown_code", "no such code (or it was burnt)");
  if (row.used === 1) return no("code_used", "this code has already been used");
  const now = io.now();
  if (now - row.issued_at > CODE_TTL_S) return no("code_expired", "this code has expired; sign in again");
  const challenge = fromBase64url(row.challenge);
  if (!sameBytes(issuer.sha3(verifier), challenge)) return failed(io, key, "verifier_mismatch", "the verifier does not answer this code's challenge");
  if (client.aud !== row.aud) return failed(io, key, "audience_mismatch", "this code was issued to another client");
  if (!(await io.signIn.markUsed(key))) return no("code_used", "this code has already been used");

  const assertion = issuer.signAssertion(fromBase64url(row.identity_pk), device, client.aud, now + ASSERTION_TTL_S, challenge);
  return json({ v: 1, issuer: issuer.domain, assertion: toBase64url(assertion) });
}

async function failed(io, key, reason, detail) {
  await io.signIn.codeFailed(key, MAX_CODE_FAILURES);
  return no(reason, detail);
}
