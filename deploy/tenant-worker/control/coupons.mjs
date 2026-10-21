/**
 * Coupons at the door: judging a code for a plan (creation and preview share it), and the preview
 * route the plan step calls before anything is created.
 *
 *   POST /api/coupons/preview {code, tier, interval, seats, storage_blocks, link_packs}
 *     200 {applies: true, kind: "discount" | "trial" | "comp", ...}   (control/coupon-rules.mjs offerOf)
 *     400 coupon-unavailable, the same bytes for every reason a code does not apply
 *     429 coupon-rate-limited, past MAX_PREVIEWS_PER_HOUR from one address
 *
 * Every refusal is one body so the route is no oracle; the preview is the guessing surface, so it
 * is counted per hashed client address before anything is looked up. Creation is Turnstile-gated
 * and re-judges the code itself: a preview is never a promise.
 */
import { json, refuse } from "./http.mjs";
import { isPaid, tierIds } from "./plans.mjs";
import { codeHash, MAX_PREVIEWS_PER_HOUR, normaliseCode, offerOf, pick, redeemable, staticCoupons } from "./coupon-rules.mjs";
import { malformed, readPaidPlan } from "./plan-request.mjs";
import { sha256Hex } from "./secrets.mjs";

export const couponUnavailable = () => refuse("coupon-unavailable", "that code cannot be applied to this plan", 400);
const rateLimited = () => refuse("coupon-rate-limited", "Too many attempts. Try again in an hour.", 429);
const PREVIEW_FIELDS = new Set(["code", "tier", "interval", "seats", "storage_blocks", "link_packs"]);
/** The label an address is hashed under, so its hash matches no other table's. */
const ATTEMPT_LABEL = "citadel-coupon-attempt-v1\0";

/**
 * `{coupon}` when `code` (normalised, or null for a value of the wrong shape) may be redeemed for
 * `plan` ({slug | null, tier, interval}) now, else `{error}`: the uniform refusal. The lookup is
 * the same statements whether or not the code exists (control/coupon-store.mjs `lookup`).
 */
export async function couponFor(io, code, plan) {
  if (code === null) return { error: couponUnavailable() };
  const hash = await codeHash(code);
  const { row, held } = await io.coupons.lookup(hash, io.now(), plan.slug);
  const coupon = pick(await staticCoupons(), hash, row);
  const verdict = redeemable(coupon, plan, io.nowMs(), held);
  return verdict.ok ? { coupon } : { error: couponUnavailable() };
}

export async function previewCoupon(io, body, ip) {
  // Counted first, malformed or not: nothing is looked up past the limit.
  const hour = Math.floor(io.now() / 3600);
  const attempts = await io.coupons.countAttempt(await sha256Hex(`${ATTEMPT_LABEL}${ip ?? ""}`), hour);
  if (attempts > MAX_PREVIEWS_PER_HOUR) return rateLimited();
  const extra = Object.keys(body).filter((k) => !PREVIEW_FIELDS.has(k));
  if (extra.length) return malformed(`unknown fields: ${extra.join(", ")}`).error;
  if (!tierIds().includes(body.tier)) return malformed(`tier is one of ${tierIds().join(", ")}`).error;
  // The free tier takes no coupon: refused as every other code that does not apply.
  if (!isPaid(body.tier)) return couponUnavailable();
  const paid = readPaidPlan(body);
  if (paid.error) return paid.error;
  const found = await couponFor(io, normaliseCode(body.code), { slug: null, tier: body.tier, interval: paid.fields.interval });
  if (found.error) return found.error;
  return json(offerOf(found.coupon));
}
