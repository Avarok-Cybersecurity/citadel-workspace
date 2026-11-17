/**
 * "Sign in with Citadel", the issuer (batch 1116 lane I4c): begin, prove, complete, against C0's
 * known answers (sign-in-kat.json) and schema. Every `proof_must_fail` and `must_fail` case, each
 * refused for its own reason; the happy path reproduces the contract's begin, prove and complete
 * fixtures byte for byte, the assertion included.
 */
import { describe, expect, it } from "vitest";
import {
  ASSERTION_TTL_S, ATTEMPT_TTL_S, beginSignIn, CODE_TTL_S, completeSignIn, MAX_CODE_FAILURES, MAX_PROOF_FAILURES, proveSignIn,
} from "../control/sign-in-issuer.mjs";
import { CODE_ALPHABET } from "../control/sign-in-code.mjs";
import { issuerOf } from "../control/control-identity.mjs";
import {
  b64, beginBody, breaks, BROWSER_RETURN, CFG, codeBytes, crossRoleProof, fromHex, issuer, KAT, KAT_DEVICE, KAT_NONCE, KAT_PROOF, KAT_VERIFIER,
  katIo, proofWithKeyB, read, signInFixture,
} from "./sign-in-helpers.mjs";

/** The assertion's `now`: the KAT's exp minus the 30 days it is valid for. */
const T_COMPLETE = KAT.assertion.exp_s - ASSERTION_TTL_S;
const T_BEGIN = T_COMPLETE - 100;

/** Begins an attempt whose nonce is `nonce` (the KAT's unless given), returning its id. */
async function begun(io, overrides = {}, nonce = KAT_NONCE) {
  const queue = [crypto.getRandomValues(new Uint8Array(16)), nonce];
  const r = await read(await beginSignIn({ ...io, random: katIo({ now: io.now() }, queue).random }, issuer(), beginBody(overrides)));
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.attempt;
}

const prove = async (io, attempt, proof = KAT_PROOF, iss = issuer()) => read(await proveSignIn(io, iss, { v: 1, attempt, proof }));
const complete = async (io, code, overrides = {}) =>
  read(await completeSignIn(io, issuer(), { v: 1, client: "sw-mcp", code, verifier: KAT_VERIFIER, device: KAT_DEVICE, ...overrides }));

describe("the contract's constants", () => {
  it("are the issuer's", () => {
    expect(ATTEMPT_TTL_S).toBe(KAT.proof_constants.ATTEMPT_TTL_S);
    expect(MAX_PROOF_FAILURES).toBe(KAT.proof_constants.MAX_PROOF_FAILURES);
    expect(CODE_TTL_S).toBe(KAT.code.ttl_s);
    expect(CODE_ALPHABET).toBe(KAT.code.alphabet);
    expect(MAX_CODE_FAILURES).toBe(5);
  });
});

describe("the whole exchange reproduces the contract", () => {
  it("begin, prove and complete answer C0's fixtures byte for byte, and the code's record carries the proof's key", async () => {
    const clock = { now: T_BEGIN };
    const code = signInFixture("ReturnPost/valid.json").code;
    const io = katIo(clock, [fromHex(KAT.attempt.id_hex), KAT_NONCE, codeBytes(code)]);
    const begin = await read(await beginSignIn(io, issuer(), beginBody()));
    expect(begin).toEqual({ status: 200, body: signInFixture("SignInBeginResponse/valid.json") });
    expect(breaks("SignInBeginResponse", begin.body)).toBeNull();

    clock.now = T_BEGIN + 50;
    const proved = await prove(io, begin.body.attempt);
    expect(proved).toEqual({ status: 200, body: signInFixture("SignInProveResponse/valid.json") });
    expect(breaks("SignInProveResponse", proved.body)).toBeNull();
    const stored = await io.signIn.code(Array.from(issuer().sha3(new TextEncoder().encode(code)), (b) => b.toString(16).padStart(2, "0")).join(""));
    expect(stored.identity_pk).toBe(KAT.proof.identity_pk_b64url);

    clock.now = T_COMPLETE;
    const done = await complete(io, code);
    expect(done).toEqual({ status: 200, body: signInFixture("SignInCompleteResponse/valid.json") });
    expect(done.body.assertion).toBe(KAT.assertion.blob_b64url);
    expect(breaks("SignInCompleteResponse", done.body)).toBeNull();
  });
});

describe("proof_must_fail: every case is refused for its own reason, and no code is issued", () => {
  const cases = Object.fromEntries(KAT.proof_must_fail.map((c) => [c.reason === "bad_signature" ? c.case : c.reason, c]));

  it("wrong origin: identity A's valid signature over a phishing page's origin", async () => {
    const io = katIo({ now: T_BEGIN });
    expect(await prove(io, await begun(io), cases.wrong_origin.blob_b64url)).toMatchObject({ status: 400, body: { error: "wrong_origin" } });
  });

  it("another identity's key under A's signature (the forged proof)", async () => {
    const io = katIo({ now: T_BEGIN });
    const c = cases["another identity's key under A's signature"];
    expect(await prove(io, await begun(io), proofWithKeyB())).toMatchObject({ status: 400, body: { error: c.reason } });
  });

  it("wrong issuer: the proof verified by an issuer at another domain", async () => {
    const io = katIo({ now: T_BEGIN });
    const other = issuerOf({ ...CFG, controlHost: cases.wrong_issuer.verify_with_issuer });
    expect(await prove(io, await begun(io), KAT_PROOF, other)).toMatchObject({ status: 400, body: { error: "wrong_issuer" } });
  });

  it("mismatched audience: an sw-mcp proof on a synchronized.work attempt", async () => {
    const io = katIo({ now: T_BEGIN });
    const attempt = await begun(io, { client: cases.audience_mismatch.verify_with_aud, return: BROWSER_RETURN });
    expect(await prove(io, attempt)).toMatchObject({ status: 400, body: { error: "audience_mismatch" } });
  });

  it("a replayed or foreign nonce", async () => {
    const io = katIo({ now: T_BEGIN });
    const attempt = await begun(io, {}, fromHex(cases.nonce_mismatch.verify_with_nonce_hex));
    expect(await prove(io, attempt)).toMatchObject({ status: 400, body: { error: "nonce_mismatch" } });
  });

  it("another attempt's challenge", async () => {
    const io = katIo({ now: T_BEGIN });
    const attempt = await begun(io, { challenge: b64(fromHex(cases.challenge_mismatch.verify_with_challenge_hex)) });
    expect(await prove(io, attempt)).toMatchObject({ status: 400, body: { error: "challenge_mismatch" } });
  });

  it("cross-role: a binding-domain signature over the proof body", async () => {
    const io = katIo({ now: T_BEGIN });
    expect(await prove(io, await begun(io), crossRoleProof())).toMatchObject({ status: 400, body: { error: "bad_signature" } });
  });

  it("a second prove on a proven attempt", async () => {
    const io = katIo({ now: T_BEGIN });
    const attempt = await begun(io);
    expect((await prove(io, attempt)).status).toBe(200);
    expect(await prove(io, attempt)).toMatchObject({ status: 400, body: { error: "attempt_proven" } });
  });

  it("an expired attempt: prove at begin + 301 s, while begin + 300 s still proves", async () => {
    const clock = { now: T_BEGIN };
    const io = katIo(clock);
    const late = await begun(io);
    const onTime = await begun(io);
    clock.now = T_BEGIN + ATTEMPT_TTL_S + 1;
    expect(await prove(io, late)).toMatchObject({ status: 400, body: { error: "attempt_expired" } });
    clock.now = T_BEGIN + ATTEMPT_TTL_S;
    expect((await prove(io, onTime)).status).toBe(200);
  });

  it("five failed proofs burn the attempt; four do not", async () => {
    const io = katIo({ now: T_BEGIN });
    const [burnt, kept] = [await begun(io), await begun(io)];
    for (let i = 0; i < MAX_PROOF_FAILURES; i++) expect((await prove(io, burnt, crossRoleProof())).status).toBe(400);
    expect(await prove(io, burnt)).toMatchObject({ status: 400, body: { error: "unknown_attempt" } });
    for (let i = 0; i < MAX_PROOF_FAILURES - 1; i++) expect((await prove(io, kept, crossRoleProof())).status).toBe(400);
    expect((await prove(io, kept)).status).toBe(200);
  });

  it("a malformed proof and an unknown attempt", async () => {
    const io = katIo({ now: T_BEGIN });
    expect(await prove(io, await begun(io), "AQ")).toMatchObject({ status: 400, body: { error: "malformed_proof" } });
    expect(await prove(io, b64(new Uint8Array(16)))).toMatchObject({ status: 400, body: { error: "unknown_attempt" } });
  });
});

/** A fresh proven code (the KAT proof on a KAT-nonce attempt) and the clock it was issued at. */
async function provenCode() {
  const clock = { now: T_BEGIN };
  const io = katIo(clock);
  const r = await prove(io, await begun(io));
  expect(r.status).toBe(200);
  return { io, clock, code: r.body.code };
}

describe("must_fail: the code's checks", () => {
  it("a replayed code: the second completion is refused, the first signed", async () => {
    const { io, code } = await provenCode();
    expect((await complete(io, code)).status).toBe(200);
    expect(await complete(io, code)).toMatchObject({ status: 400, body: { error: "code_used" } });
  });

  it("a wrong verifier", async () => {
    const { io, code } = await provenCode();
    const wrong = KAT.must_fail.find((c) => c.case === "wrong verifier").verifier_hex;
    expect(await complete(io, code, { verifier: b64(fromHex(wrong)) })).toMatchObject({ status: 400, body: { error: "verifier_mismatch" } });
    expect((await complete(io, code)).status).toBe(200);
  });

  it("an expired code: complete at issued_at + 601 s, while + 600 s still completes", async () => {
    const late = await provenCode();
    late.clock.now += CODE_TTL_S + 1;
    expect(await complete(late.io, late.code)).toMatchObject({ status: 400, body: { error: "code_expired" } });
    const onTime = await provenCode();
    onTime.clock.now += CODE_TTL_S;
    expect((await complete(onTime.io, onTime.code)).status).toBe(200);
  });

  it("an off-allowlist return is refused at begin, before any attempt exists", async () => {
    const io = katIo({ now: T_BEGIN }, [new Uint8Array(16).fill(7), KAT_NONCE]);
    const evil = KAT.must_fail.find((c) => c.case === "off-allowlist return").return;
    expect(await read(await beginSignIn(io, issuer(), beginBody({ return: evil })))).toMatchObject({ status: 400, body: { error: "return_not_allowlisted" } });
    expect(await io.signIn.attempt(b64(new Uint8Array(16).fill(7)))).toBeNull();
  });

  it("a mismatched audience: a code issued to sw-mcp, completed as synchronized.work", async () => {
    const { io, code } = await provenCode();
    const aud = KAT.must_fail.find((c) => c.case === "mismatched audience").verify_with_aud;
    expect(await complete(io, code, { client: aud })).toMatchObject({ status: 400, body: { error: "audience_mismatch" } });
  });

  it("an expired assertion: what is signed expires exactly 30 days after completion", async () => {
    const { io, clock, code } = await provenCode();
    clock.now = T_COMPLETE;
    const { body } = await complete(io, code);
    const blob = Uint8Array.from(atob(body.assertion.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
    const at = 1 + 2 + "sw-mcp".length + 2 + KAT_DEVICE.length;
    const exp = new DataView(blob.buffer).getBigUint64(at);
    expect(exp).toBe(BigInt(KAT.must_fail.find((c) => c.case === "expired assertion").now_s));
  });

  it("five failed completions burn the code", async () => {
    const { io, code } = await provenCode();
    for (let i = 0; i < MAX_CODE_FAILURES; i++) expect((await complete(io, code, { client: "synchronized.work" })).status).toBe(400);
    expect(await complete(io, code)).toMatchObject({ status: 400, body: { error: "unknown_code" } });
  });

  it("an unknown client and an unknown code", async () => {
    const { io, code } = await provenCode();
    expect(await complete(io, code, { client: "elsewhere" })).toMatchObject({ status: 400, body: { error: "unknown_client" } });
    expect(await complete(io, "ZZZZ-ZZZZ")).toMatchObject({ status: 400, body: { error: "unknown_code" } });
  });
});
