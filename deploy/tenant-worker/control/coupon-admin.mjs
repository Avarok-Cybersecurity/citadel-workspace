/**
 * Dynamic coupons, issued and revoked by Avarok's signed admin tool:
 *
 *   POST /api/admin/coupons/issue         -> 201 { issued: true, code_hash, kind }
 *   POST /api/admin/coupons/revoke        -> 200 { revoked: true, grants_ended: [slug] }
 *   POST /api/admin/coupons/list          -> 200 { coupons: [...], statics: [...] }
 *   POST /api/admin/coupons/redemptions   -> 200 { code_hash, redemptions: [...], events: [...] }
 *
 * The support routes' order (control/support.mjs), under a signing domain and key of their own
 * (CITADEL_ADMIN_MLDSA_PUBLIC_KEY), so a support-read key can never issue a coupon: the signature
 * is verified first (an unsigned request stores nothing), its nonce is claimed in support_nonces
 * (it is served once), and only then is anything done. `io.verifyAdmin(publicKeyHex, body,
 * audience, nowMs)` answers `{ok: true, payload}` or `{ok: false, reason}`.
 *
 * Not a browser API: no Origin is required, and no CORS header is ever sent.
 */
import { json, readText, refuse } from "./http.mjs";
import { COUPONS, entitlements, FREE_PLAN } from "./plans.mjs";
import { codeHash, dynamicCoupon, kindOf, staticCoupons } from "./coupon-rules.mjs";
import { issuedCoupon, readAdminPayload } from "./coupon-admin-payload.mjs";

/** `{ payload, signature }`: a payload of at most 4096 bytes and a 6618-character signature. */
const ADMIN_BODY_LIMIT = 12288;
const ROUTES = { issue: "issue_coupon", revoke: "revoke_coupon", list: "list_coupons", redemptions: "list_redemptions" };

/** The route `parts` (after "api") name, or null when they are not a coupon-admin route. */
export const couponAdminRoute = (method, parts) =>
  method === "POST" && parts.length === 3 && parts[0] === "admin" && parts[1] === "coupons" && Object.hasOwn(ROUTES, parts[2]) ? parts[2] : null;

export async function serveCouponAdmin(io, cfg, request, route) {
  if (cfg.adminPublicKey === null) {
    return refuse("unconfigured", "coupon administration needs CITADEL_ADMIN_MLDSA_PUBLIC_KEY", 503);
  }
  const read = await readText(request, ADMIN_BODY_LIMIT);
  if (read.error) return read.error;
  const nowMs = io.nowMs();
  const verified = await io.verifyAdmin(cfg.adminPublicKey, read.text, cfg.controlHost, nowMs);
  if (verified?.ok !== true) return refuse("unauthorized", String(verified?.reason ?? "the request does not verify"), 401);
  const payload = readAdminPayload(verified.payload, cfg.controlHost, nowMs);
  if (payload.error) return refuse("malformed-request", payload.error, 400);
  if (payload.action.kind !== ROUTES[route]) {
    return refuse("wrong-route", `a ${payload.action.kind} request is not served at /api/admin/coupons/${route}`, 400);
  }
  if (!(await io.support.claimNonce(payload.nonce, payload.expires_at_ms, nowMs))) {
    return refuse("replayed", "this request has already been served", 409);
  }
  const act = { issue, revoke, list, redemptions }[route];
  return act(io, payload, nowMs);
}

async function isStatic(hash) {
  return (await staticCoupons()).some((s) => s.code_hash === hash);
}

async function issue(io, { nonce, action }, nowMs) {
  const hash = await codeHash(action.code);
  // A dynamic code may not shadow a public one: the static code would win every lookup.
  if (await isStatic(hash)) return refuse("coupon-exists", "that code is a static code in billing/tiers.json", 409);
  const coupon = { ...issuedCoupon(action), code_hash: hash };
  if (!(await io.coupons.issue(coupon, nowMs, nonce, action.note))) return refuse("coupon-exists", "that code has already been issued", 409);
  return json({ issued: true, code_hash: hash, kind: kindOf(action.template, action.grant_id) }, 201);
}

/**
 * Revokes a dynamic code. With `also_revoke_grants`, every tenant holding a grant through it falls
 * back to Free (data kept) in the same batch, and its object is given the new entitlements now;
 * one that is not reached now is caught up by the monitor's drift repair.
 */
async function revoke(io, { nonce, action }, nowMs) {
  const hash = await codeHash(action.code);
  if (await isStatic(hash)) return refuse("static-coupon", "a static code is withdrawn by removing it from billing/tiers.json", 400);
  const holders = action.also_revoke_grants ? await io.coupons.grantHolders(hash) : [];
  const ended = action.also_revoke_grants ? { ...FREE_PLAN, status: "active" } : null;
  if (!(await io.coupons.revoke(hash, nowMs, nonce, { also_revoke_grants: action.also_revoke_grants }, ended))) {
    return refuse("not-found", "no unrevoked dynamic code by that name", 404);
  }
  const reached = [];
  for (const { slug } of holders) {
    const row = await io.store.holder(slug, io.now());
    if (!row || row.grant_id !== null) continue;
    try {
      await io.tenant(slug).setEntitlements(entitlements(row));
      reached.push(slug);
    } catch (e) {
      console.error(`[control] revoking ${slug}'s grant: the object was not reached (${e?.message ?? e}); the monitor repairs it`);
    }
  }
  return json({ revoked: true, grants_ended: holders.map((h) => h.slug), objects_updated: reached });
}

async function list(io) {
  const coupons = (await io.coupons.list(io.now())).map(({ row, held, holders }) => {
    const c = dynamicCoupon(row);
    const grant = row.grant_id === null ? null : COUPONS.grants.get(row.grant_id);
    return {
      code_hash: row.code_hash, kind: c?.kind ?? "unknown", template: row.template, grant_id: row.grant_id, unlimited: grant?.unlimited ?? false,
      available_on: JSON.parse(row.available_on), intervals: JSON.parse(row.intervals), max_redemptions: row.max_redemptions, held,
      redeem_by_ms: row.redeem_by_ms, revoked_at_ms: row.revoked_at_ms, issued_at_ms: row.issued_at_ms, note: row.note, grant_holders: holders,
    };
  });
  return json({ coupons, statics: COUPONS.statics.map((s) => ({ ...s })) });
}

async function redemptions(io, { action }) {
  const hash = await codeHash(action.code);
  return json({ code_hash: hash, ...(await io.coupons.redemptions(hash)) });
}
