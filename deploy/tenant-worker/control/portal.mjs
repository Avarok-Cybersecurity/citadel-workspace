/**
 * Opening a workspace's billing portal.
 *
 * The claim code proves ownership, but since the claim email it also sits in a mailbox, and a
 * code that was forwarded, screenshotted or left in a thread must not open billing on its own.
 * So once the owner's address is verified, presenting the code does not open the portal: it
 * mails a single-use link, good for PORTAL_LINK_TTL_SECONDS, to that verified address, and the
 * link opens it. Before the address is verified there is no proven mailbox to send to, and the
 * code opens the portal as it always has.
 *
 * The link's token sits in the fragment (never sent to a server, never in a Referer), is held
 * only as a hash, and is spent by the first press that uses it. Nothing here logs a code, a
 * token, a link or an address.
 */
import { checkSlug } from "./slug.mjs";
import { digestsEqual, randomHex, sha256Hex } from "./secrets.mjs";
import { stripe } from "./stripe.mjs";
import { json, refuse } from "./http.mjs";
import { mailWithinLimits } from "./owner-email.mjs";

export const PORTAL_LINK_TTL_SECONDS = 30 * 60;
const HEX64 = /^[0-9a-f]{64}$/;
const NOT_OWNER = () => refuse("not-owner", "that claim code does not own this workspace", 403);
const BAD_LINK = () => refuse("link-invalid", "that billing link has expired or has already been used", 400);

export function portalMessage(cfg, slug, token) {
  const link = `${cfg.publicOrigin}/billing#slug=${encodeURIComponent(slug)}&t=${token}`;
  return {
    subject: "Manage your Citadel workspace's billing",
    text:
      "Someone asked to manage your Citadel workspace's billing with its claim code.\n\n" +
      `Open this link to continue. It works once, for the next ${PORTAL_LINK_TTL_SECONDS / 60} minutes:\n${link}\n\n` +
      "If this wasn't you, someone else has your claim code. Nothing has changed, and they cannot manage billing without this email.\n",
  };
}

async function portalSession(io, cfg, row) {
  if (!row.stripe_customer) return refuse("no-subscription", "this workspace has no subscription to manage", 404);
  if (!cfg.portalConfiguration) return refuse("portal-not-configured", "managing a subscription is not available yet", 503);
  const session = await stripe(io, cfg.stripeKey, "POST", "/billing_portal/sessions", {
    customer: row.stripe_customer,
    configuration: cfg.portalConfiguration,
    return_url: `${cfg.publicOrigin}/`,
  });
  return json({ portal_url: session.url });
}

/** POST /api/tenants/:slug/portal {claim_code}: the portal, or, for a verified owner, a mailed link to it. */
export async function openPortal(io, cfg, slug, body, client) {
  if (!cfg.stripeKey) return refuse("billing-not-configured", "billing is not available yet", 503);
  if (!checkSlug(slug).ok) return refuse("not-found", "no such workspace", 404);
  const row = await io.store.holder(slug, io.now());
  const presented = typeof body.claim_code === "string" && HEX64.test(body.claim_code) ? body.claim_code : null;
  // One answer for "no such workspace" and "wrong code", so the route is no oracle for either.
  if (!row || !presented || !digestsEqual(await sha256Hex(presented), row.claim_hash)) return NOT_OWNER();
  if (row.email_verified_at === null || !row.owner_email) return portalSession(io, cfg, row);
  if (!row.stripe_customer) return refuse("no-subscription", "this workspace has no subscription to manage", 404);
  const token = randomHex(32);
  const sent = await mailWithinLimits(io, { to: row.owner_email, client, what: `the billing link for ${slug}` }, portalMessage(cfg, slug, token));
  if (!sent.sent) return refuse("portal-link-not-sent", "the billing link could not be emailed; try again later", 503);
  await io.store.recordPortalLink(slug, row.tenant_id, await sha256Hex(token), io.now() + PORTAL_LINK_TTL_SECONDS);
  return json({ portal_emailed: true });
}

/** POST /api/tenants/:slug/portal-link {token}: spends a mailed billing link and opens the portal. */
export async function openPortalByLink(io, cfg, slug, body) {
  if (!cfg.stripeKey) return refuse("billing-not-configured", "billing is not available yet", 503);
  if (!checkSlug(slug).ok) return refuse("not-found", "no such workspace", 404);
  const token = typeof body?.token === "string" && HEX64.test(body.token) ? body.token : null;
  if (token === null || !(await io.store.takePortalLink(slug, await sha256Hex(token), io.now()))) return BAD_LINK();
  const row = await io.store.holder(slug, io.now());
  if (!row) return BAD_LINK();
  return portalSession(io, cfg, row);
}
