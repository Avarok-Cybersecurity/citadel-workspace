/**
 * Creating a tenant, reporting its status, and opening its billing portal.
 */
import { checkSlug } from "./slug.mjs";
import { displayNameOf, MAX_DISPLAY_NAME } from "./display-name.mjs";
import { ADDONS, COUPONS, entitlements, isPaid, tierIds } from "./plans.mjs";
import { noAddons } from "./addons.mjs";
import { CLAIM_SEAL, digestsEqual, randomHex, RESERVATION_SEAL, seal, sha256Hex, unseal } from "./secrets.mjs";
import { CREATE_ACTION, verifyTurnstile } from "./turnstile.mjs";
import { stripe } from "./stripe.mjs";
import { json, refuse } from "./http.mjs";
import { readAcceptedTerms } from "./customer-terms.mjs";
import { expireCheckout, openCheckout } from "./checkout.mjs";
import { couponFor, couponUnavailable } from "./coupons.mjs";
import { normaliseCode } from "./coupon-rules.mjs";
import { malformed, readPaidPlan } from "./plan-request.mjs";
import { EXHAUSTED, RESERVED } from "./store.mjs";

/** How long a free tenant's reservation holds its slug should the request die mid-way. */
const FREE_RESERVATION_SECONDS = 300;
/** Past the Checkout's own expiry, so a payment completed at the last second still finds its row. */
const CHECKOUT_GRACE_SECONDS = 600;
const CREATE_FIELDS = new Set([
  "slug", "display_name", "tier", "interval", "seats", ...ADDONS.map((a) => a.quantityField), "turnstile_token", "reservation_token",
  "accepted_customer_terms_version", "coupon_code",
]);
const PAID_ONLY = ["interval", "seats", ...ADDONS.map((a) => a.quantityField), "coupon_code"];
const TOKEN = /^[0-9a-f]{64}$/;
const DAY_SECONDS = 86400;

/**
 * The creation request, checked field by field: `{plan, token, retry, coupon}` or `{error:
 * Response}`. `coupon` is the normalised code, null when none was given, or the uniform refusal
 * for a value of the wrong shape (the shape is public, so refusing it early tells nothing).
 */
export function readCreate(body) {
  const bad = malformed;
  const extra = Object.keys(body).filter((k) => !CREATE_FIELDS.has(k));
  if (extra.length) return bad(`unknown fields: ${extra.join(", ")}`);
  const terms = readAcceptedTerms(body);
  if (terms.error) return terms;
  const slug = checkSlug(body.slug);
  if (!slug.ok) return { error: refuse(`slug-${slug.reason}`, `that address is ${slug.reason}`, 400) };
  const name = displayNameOf(body.display_name);
  if (name === null) return bad(`display_name is 1 to ${MAX_DISPLAY_NAME} printable characters`);
  if (!tierIds().includes(body.tier)) return bad(`tier is one of ${tierIds().join(", ")}`);
  if (typeof body.turnstile_token !== "string" || body.turnstile_token.length < 1 || body.turnstile_token.length > 2048) {
    return bad("turnstile_token is required");
  }
  if (body.reservation_token !== undefined && !TOKEN.test(String(body.reservation_token))) {
    return bad("reservation_token is the 64 hex characters a paid creation returned");
  }
  const retry = body.reservation_token ?? null;
  const plan = {
    slug: body.slug, customer_terms_version: terms.version, display_name: name, tier: body.tier, interval: null, seats: 0, ...noAddons(ADDONS),
  };
  if (!isPaid(body.tier)) {
    const named = PAID_ONLY.filter((k) => body[k] !== undefined);
    if (named.length) return bad(`the free tier takes no ${PAID_ONLY.join(", ")} (given ${named.join(", ")})`);
    return { plan, token: body.turnstile_token, retry, coupon: null };
  }
  const paid = readPaidPlan(body);
  if (paid.error) return paid;
  if (body.coupon_code !== undefined && typeof body.coupon_code !== "string") return bad("coupon_code is a string");
  const coupon = body.coupon_code === undefined ? null : normaliseCode(body.coupon_code);
  if (body.coupon_code !== undefined && coupon === null) return { error: couponUnavailable() };
  return { plan: { ...plan, ...paid.fields }, token: body.turnstile_token, retry, coupon };
}

const hostOf = (cfg, slug) => `${slug}.${cfg.controlHost}`;

export async function slugAvailability(io, slug) {
  const checked = checkSlug(slug);
  if (!checked.ok) return json({ slug, available: false, reason: checked.reason });
  const held = await io.store.holder(slug, io.now());
  return json(held ? { slug, available: false, reason: "taken" } : { slug, available: true });
}

export async function createTenant(io, cfg, body, ip) {
  if (!cfg.turnstile) return refuse("turnstile-not-configured", "workspace creation is not available yet", 503);
  const read = readCreate(body);
  if (read.error) return read.error;
  const { plan } = read;
  const paid = isPaid(plan.tier);
  if (paid && !cfg.stripeKey) return refuse("billing-not-configured", "paid plans are not available yet", 503);

  const failed = await verifyTurnstile(io, cfg.turnstile, read.token, CREATE_ACTION, ip);
  if (failed) return refuse("turnstile", failed, 403);

  let coupon = null;
  if (read.coupon !== null) {
    const found = await couponFor(io, read.coupon, plan);
    if (found.error) return found.error;
    coupon = found.coupon;
  }
  // A comp grant needs no payment: the tenant is activated at once, on the grant's own plan.
  const grant = coupon?.kind === "comp" ? COUPONS.grants.get(coupon.grant_id) : null;
  const checkoutBound = paid && grant === null;

  const now = io.now();
  const claim = randomHex(32);
  // Only a creation that waits on Checkout is left pending for its creator to come back to.
  const reservation = checkoutBound ? randomHex(32) : null;
  const trialDays = coupon?.kind === "trial" ? COUPONS.templates.get(coupon.template).trial_days : null;
  const row = {
    ...plan,
    ...(grant === null ? {} : { tier: grant.tier_as, interval: null, seats: grant.seats, ...noAddons(ADDONS) }),
    tenant_id: randomHex(16),
    claim_hash: await sha256Hex(claim),
    reservation_hash: reservation === null ? null : await sha256Hex(reservation),
    expires_at: now + (checkoutBound ? cfg.checkoutTtl + CHECKOUT_GRACE_SECONDS : FREE_RESERVATION_SECONDS),
    coupon_hash: coupon?.code_hash ?? null,
    // Granted when it activates; until Stripe names the trial's end, the end it was offered.
    grant_id: null,
    grant_unlimited: 0,
    trial_end: trialDays === null ? null : now + trialDays * DAY_SECONDS,
    stripe_status: null,
  };
  const couponStatements = (replacing) => io.coupons.reservation({ coupon, row, nowSec: now, nowMs: io.nowMs(), replacing });
  const reserved = await io.store.reserve(row, now, couponStatements(null));
  if (reserved === EXHAUSTED) return couponUnavailable();
  if (reserved !== RESERVED) {
    const refused = read.retry === null ? SLUG_TAKEN() : await supersede(io, cfg, read.retry, row, now, couponStatements);
    if (refused) return refused;
  }

  try {
    const active = grant === null ? {} : { grant_id: grant.id, grant_unlimited: grant.unlimited ? 1 : 0 };
    await io.tenant(plan.slug).provision({
      tenant_id: row.tenant_id,
      master_password: claim,
      display_name: plan.display_name,
      entitlements: entitlements({ ...row, ...active, status: checkoutBound ? "pending" : "active", period_start: null, period_end: null }),
    });
    if (!checkoutBound) {
      if (grant === null) await io.store.activateFree(plan.slug, row.tenant_id);
      else await io.coupons.activateComp(plan.slug, row.tenant_id, grant.id, grant.unlimited, io.nowMs());
      return json({ slug: plan.slug, status: "active", workspace_host: hostOf(cfg, plan.slug), claim_code: claim }, 201);
    }
    const checkout = await openCheckout(io, cfg, row, now, coupon);
    await io.store.attachCheckout(
      plan.slug,
      row.tenant_id,
      await sha256Hex(checkout.id),
      await seal(CLAIM_SEAL, checkout.id, claim, row.tenant_id),
      await seal(RESERVATION_SEAL, reservation, checkout.id, row.tenant_id),
    );
    return json(
      { slug: plan.slug, status: "pending", workspace_host: hostOf(cfg, plan.slug), checkout_url: checkout.url, reservation_token: reservation },
      201,
    );
  } catch (e) {
    await io.store.release(plan.slug, row.tenant_id, io.coupons.releasing(row.tenant_id, io.nowMs()));
    console.error(`[control] creating ${plan.slug} failed: ${e?.message ?? e}`);
    return refuse("provisioning-failed", "the workspace could not be created; nothing was charged", 502);
  }
}

const SLUG_TAKEN = () => refuse("slug-taken", "that address is taken", 409);

/**
 * A retry of a paid creation by whoever started it (a visitor who cancelled at Stripe and came
 * back): `token` is the reservation token its 201 returned. The pending reservation it matches
 * is replaced by `row`, after its Checkout Session is expired at Stripe so it can no longer be
 * paid. Null when `row` now holds the slug, else the refusal: a wrong token, or a slug that is not
 * a pending reservation, is the same 409 as no token at all. `couponStatements(replacing)` are the
 * coupon statements of the replacing batch, which drops the replaced reservation's redemption.
 */
async function supersede(io, cfg, token, row, now, couponStatements) {
  const held = await io.store.holder(row.slug, now);
  if (!held || held.status !== "pending" || !digestsEqual(held.reservation_hash ?? "", await sha256Hex(token))) return SLUG_TAKEN();
  if (held.checkout_sealed) {
    if (!cfg.stripeKey) return refuse("billing-not-configured", "paid plans are not available yet", 503);
    const oldSession = await unseal(RESERVATION_SEAL, token, held.checkout_sealed, held.tenant_id);
    if (oldSession === null) throw new Error(`the reservation of ${row.slug} did not unseal under its own token`);
    if (!(await expireCheckout(io, cfg, oldSession))) {
      return refuse("checkout-completed", "that checkout was already completed; the workspace is being set up", 409);
    }
  }
  // A late webhook for the old session names the old tenant_id, which no row holds any more.
  const replaced = await io.store.supersede(held, row, now, couponStatements(held.tenant_id));
  if (replaced === EXHAUSTED) return couponUnavailable();
  return replaced === RESERVED ? null : SLUG_TAKEN();
}

/** Pending or active; and, once active, to the caller holding the Checkout Session id, the claim code once. */
export async function tenantStatus(io, cfg, slug, sessionId) {
  if (!checkSlug(slug).ok) return refuse("not-found", "no such workspace", 404);
  const row = await io.store.holder(slug, io.now());
  if (!row) return refuse("not-found", "no such workspace", 404);
  const answer = { slug, status: row.status, tier: row.tier, workspace_host: hostOf(cfg, slug) };
  if (row.status !== "active" || typeof sessionId !== "string" || sessionId.length < 8 || sessionId.length > 255) {
    return json(answer);
  }
  const held = await io.store.sealedClaim(slug, await sha256Hex(sessionId));
  if (!held) return json(answer);
  // Unsealed before it is cleared, so a code that failed to open is not lost with the row.
  const claim = await unseal(CLAIM_SEAL, sessionId, held.claim_sealed, held.tenant_id);
  if (claim === null) throw new Error(`the claim code of ${slug} did not unseal under its own session`);
  // Two callers racing with the session id: one clears it and is answered; the other is not.
  if (!(await io.store.collectClaim(slug, held.claim_sealed))) return json(answer);
  return json({ ...answer, claim_code: claim });
}

export async function openPortal(io, cfg, slug, body) {
  if (!cfg.stripeKey) return refuse("billing-not-configured", "billing is not available yet", 503);
  if (!checkSlug(slug).ok) return refuse("not-found", "no such workspace", 404);
  const row = await io.store.holder(slug, io.now());
  const presented = typeof body.claim_code === "string" && /^[0-9a-f]{64}$/.test(body.claim_code) ? body.claim_code : null;
  // One answer for "no such workspace" and "wrong code", so the route is no oracle for either.
  if (!row || !presented || !digestsEqual(await sha256Hex(presented), row.claim_hash)) {
    return refuse("not-owner", "that claim code does not own this workspace", 403);
  }
  if (!row.stripe_customer) return refuse("no-subscription", "this workspace has no subscription to manage", 404);
  if (!cfg.portalConfiguration) return refuse("portal-not-configured", "managing a subscription is not available yet", 503);
  const session = await stripe(io, cfg.stripeKey, "POST", "/billing_portal/sessions", {
    customer: row.stripe_customer,
    configuration: cfg.portalConfiguration,
    return_url: `${cfg.publicOrigin}/`,
  });
  return json({ portal_url: session.url });
}
