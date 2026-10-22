/**
 * Coupon test plumbing. Dynamic codes are issued with the store's own `issue` (what the admin route
 * calls once a request has verified), so a test's coupon is a real D1 row in the shape production
 * writes. The one fake is `fakeAdminVerifier`, at the admin verifier's port (`io.verifyAdmin`): the
 * route tests need many payload variants, and only the native Rust tool can sign one. The real
 * server-wasm verifier is driven end to end with Rust-signed fixtures in admin-verifier.test.mjs.
 */
import { env, SELF } from "cloudflare:test";
import { ioFor } from "../control/dispatch.mjs";
import { codeHash } from "../control/coupon-rules.mjs";
import { createBody, ORIGIN } from "./helpers.mjs";

let n = 0;
/** A code no other test uses (tests share one D1 file), in tiers.json's code_shape. */
export const freshCode = (stem = "T") => `${stem}${Date.now().toString(36)}${(n++).toString(36)}`.toUpperCase().slice(0, 32);

const DAY_MS = 86400 * 1000;

/** Issues a dynamic code into D1 and returns it. Every field is stated by the test or here. */
export async function issueCode(fields) {
  const code = fields.code ?? freshCode();
  const coupon = {
    template: null, grant_id: null, available_on: ["team", "business"], intervals: ["month", "year"], max_redemptions: 100,
    redeem_by_ms: Date.now() + 30 * DAY_MS, ...fields, code_hash: await codeHash(code),
  };
  const issued = await ioFor(env).coupons.issue(coupon, Date.now(), crypto.randomUUID().replaceAll("-", ""), "test");
  if (!issued) throw new Error(`issuing ${code} collided`);
  return code;
}

export const paidBody = (slug, extra = {}) => createBody(slug, { tier: "team", interval: "month", seats: 3, ...extra });

/** POSTs a coupon preview from `ip` (Cloudflare's client-address header). */
export const preview = (body, ip) =>
  SELF.fetch(`${ORIGIN}/api/coupons/preview`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json", "cf-connecting-ip": ip },
    body: JSON.stringify(body),
  });

let ips = 0;
/** An address no other test previews from, so each test's rate limit starts at zero. */
export const freshIp = () => `198.51.100.${(ips++ % 250) + 1}-${Date.now()}`;

export const previewBody = (code, extra = {}) => ({ code, tier: "team", interval: "month", seats: 3, storage_blocks: 0, link_packs: 0, ...extra });

export const redemptionsOf = async (code) =>
  (await env.CONTROL_DB.prepare("SELECT * FROM coupon_redemptions WHERE coupon_hash = ? ORDER BY reserved_at").bind(await codeHash(code)).all()).results;

export const eventsOf = async (code) =>
  (await env.CONTROL_DB.prepare("SELECT action, tenant_id FROM coupon_events WHERE coupon_hash = ? ORDER BY id").bind(await codeHash(code)).all()).results;

/** The uniform refusal, byte for byte as the Worker sends it. */
export const UNAVAILABLE_BODY = JSON.stringify({ error: "coupon-unavailable", detail: "that code cannot be applied to this plan" });

/**
 * The admin verifier's port, faked: a body `{payload, signature}` verifies when its signature is
 * `admin:<the configured key>`; anything else (a support-domain signature, another key, none) is
 * refused as the real verifier refuses, with nothing returned but the reason.
 */
export function fakeAdminVerifier(publicKey, body) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, reason: "the body is not a signed admin request" };
  }
  if (parsed?.signature !== `admin:${publicKey}`) return { ok: false, reason: "the signature does not verify" };
  return { ok: true, payload: parsed.payload };
}

/** A key of the configured shape: the fake never reads it beyond equality. */
export const ADMIN_KEY = "ab".repeat(1952);
