/**
 * Creating a tenant, reporting its status, and opening its billing portal.
 */
import { checkSlug } from "./slug.mjs";
import { entitlements, intervalsOf, isPaid, maxSeats, MAX_STORAGE_BLOCKS, storageKey, storageOfferedOn, tierIds, tierKey } from "./plans.mjs";
import { CLAIM_SEAL, digestsEqual, randomHex, RESERVATION_SEAL, seal, sha256Hex, unseal } from "./secrets.mjs";
import { CREATE_ACTION, verifyTurnstile } from "./turnstile.mjs";
import { priceIds, stripe, StripeError } from "./stripe.mjs";
import { json, refuse } from "./http.mjs";

/** How long a free tenant's reservation holds its slug should the request die mid-way. */
const FREE_RESERVATION_SECONDS = 300;
/** Past the Checkout's own expiry, so a payment completed at the last second still finds its row. */
const CHECKOUT_GRACE_SECONDS = 600;
const CREATE_FIELDS = new Set(["slug", "display_name", "tier", "interval", "seats", "storage_blocks", "turnstile_token", "reservation_token"]);
const TOKEN = /^[0-9a-f]{64}$/;

const isCount = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

/** The creation request, checked field by field: `{plan}` or `{error: Response}`. */
export function readCreate(body) {
  const bad = (detail) => ({ error: refuse("malformed-request", detail, 400) });
  const extra = Object.keys(body).filter((k) => !CREATE_FIELDS.has(k));
  if (extra.length) return bad(`unknown fields: ${extra.join(", ")}`);
  const slug = checkSlug(body.slug);
  if (!slug.ok) return { error: refuse(`slug-${slug.reason}`, `that address is ${slug.reason}`, 400) };
  const name = typeof body.display_name === "string" ? body.display_name.trim() : "";
  if (name.length < 1 || name.length > 64 || /[\u0000-\u001f\u007f]/.test(name)) return bad("display_name is 1 to 64 printable characters");
  if (!tierIds().includes(body.tier)) return bad(`tier is one of ${tierIds().join(", ")}`);
  if (typeof body.turnstile_token !== "string" || body.turnstile_token.length < 1 || body.turnstile_token.length > 2048) {
    return bad("turnstile_token is required");
  }
  if (body.reservation_token !== undefined && !TOKEN.test(String(body.reservation_token))) {
    return bad("reservation_token is the 64 hex characters a paid creation returned");
  }
  const retry = body.reservation_token ?? null;
  const plan = { slug: body.slug, display_name: name, tier: body.tier, interval: null, seats: 0, storage_blocks: 0 };
  if (!isPaid(body.tier)) {
    if (body.interval !== undefined || body.seats !== undefined || body.storage_blocks !== undefined) {
      return bad("the free tier takes no interval, seats or storage_blocks");
    }
    return { plan, token: body.turnstile_token, retry };
  }
  if (!intervalsOf(body.tier).includes(body.interval)) return bad(`interval is one of ${intervalsOf(body.tier).join(", ")}`);
  if (!isCount(body.seats, 1, maxSeats(body.tier))) return bad(`seats is an integer from 1 to ${maxSeats(body.tier)}`);
  const blocks = body.storage_blocks ?? 0;
  if (!isCount(blocks, 0, MAX_STORAGE_BLOCKS)) return bad(`storage_blocks is an integer from 0 to ${MAX_STORAGE_BLOCKS}`);
  if (blocks > 0 && !storageOfferedOn(body.tier)) return bad(`extra storage is not sold on ${body.tier}`);
  return { plan: { ...plan, interval: body.interval, seats: body.seats, storage_blocks: blocks }, token: body.turnstile_token, retry };
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

  const now = io.now();
  const claim = randomHex(32);
  // Only a paid creation is left pending for its creator to come back to.
  const reservation = paid ? randomHex(32) : null;
  const row = {
    ...plan,
    tenant_id: randomHex(16),
    claim_hash: await sha256Hex(claim),
    reservation_hash: reservation === null ? null : await sha256Hex(reservation),
    expires_at: now + (paid ? cfg.checkoutTtl + CHECKOUT_GRACE_SECONDS : FREE_RESERVATION_SECONDS),
  };
  if (!(await io.store.reserve(row, now))) {
    const refused = read.retry === null ? SLUG_TAKEN() : await supersede(io, cfg, read.retry, row, now);
    if (refused) return refused;
  }

  try {
    await io.tenant(plan.slug).provision({
      tenant_id: row.tenant_id,
      master_password: claim,
      entitlements: entitlements({ ...plan, status: paid ? "pending" : "active" }),
    });
    if (!paid) {
      await io.store.activateFree(plan.slug, row.tenant_id);
      return json({ slug: plan.slug, status: "active", workspace_host: hostOf(cfg, plan.slug), claim_code: claim }, 201);
    }
    const checkout = await openCheckout(io, cfg, row, now);
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
    await io.store.release(plan.slug, row.tenant_id);
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
 * a pending reservation, is the same 409 as no token at all.
 */
async function supersede(io, cfg, token, row, now) {
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
  return (await io.store.supersede(held, row, now)) ? null : SLUG_TAKEN();
}

/** True once `sessionId` can no longer be paid: expired now, or already. */
async function expireCheckout(io, cfg, sessionId) {
  const path = `/checkout/sessions/${encodeURIComponent(sessionId)}`;
  try {
    await stripe(io, cfg.stripeKey, "POST", `${path}/expire`, {}, `expire-${sessionId}`);
    return true;
  } catch (e) {
    // Stripe refuses to expire a session that is not open; ask it which state that is.
    if (!(e instanceof StripeError) || e.status >= 500) throw e;
    return (await stripe(io, cfg.stripeKey, "GET", path)).status === "expired";
  }
}

async function openCheckout(io, cfg, row, now) {
  const tierLookup = tierKey(row.tier, row.interval);
  const keys = row.storage_blocks > 0 ? [tierLookup, storageKey(row.interval)] : [tierLookup];
  const ids = await priceIds(io, cfg.stripeKey, keys);
  const back = (path) => `${cfg.publicOrigin}${path}?tenant=${encodeURIComponent(row.slug)}`;
  const form = {
    mode: "subscription",
    client_reference_id: row.tenant_id,
    "line_items[0][price]": ids.get(tierLookup),
    "line_items[0][quantity]": String(row.seats),
    "metadata[tenant]": row.slug,
    "metadata[tenant_id]": row.tenant_id,
    // On the subscription too, so every event about it for its whole life says whose it is.
    "subscription_data[metadata][tenant]": row.slug,
    "subscription_data[metadata][tenant_id]": row.tenant_id,
    success_url: `${back("/create/done")}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${back("/create")}&canceled=1`,
    expires_at: String(now + cfg.checkoutTtl),
  };
  if (row.storage_blocks > 0) {
    form["line_items[1][price]"] = ids.get(storageKey(row.interval));
    form["line_items[1][quantity]"] = String(row.storage_blocks);
  }
  return stripe(io, cfg.stripeKey, "POST", "/checkout/sessions", form, `checkout-${row.tenant_id}`);
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
  const session = await stripe(io, cfg.stripeKey, "POST", "/billing_portal/sessions", {
    customer: row.stripe_customer,
    return_url: `${cfg.publicOrigin}/`,
  });
  return json({ portal_url: session.url });
}
