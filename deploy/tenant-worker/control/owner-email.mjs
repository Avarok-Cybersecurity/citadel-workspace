/**
 * The workspace creator's email: where the claim code goes, with a link straight to claiming.
 *
 * Owner, 2026-09-27: the email is required at /create, and following its link verifies it. The
 * workspace is still created at once and the claim code is still shown on screen; the email is
 * the copy they can come back to.
 *
 * - One message: the claim code, a link to /claim that opens the claim step already filled in
 *   (and, on the press that confirms it, verifies the address), and a "this wasn't me" link.
 *   The link carries the slug, never a host, and its secrets sit in the fragment, so no server
 *   and no Referer ever sees them.
 * - The workspace's own name is left out: it is whatever the creator typed, and a message this
 *   service sends must not let a stranger put words in its mouth.
 * - Sends are limited per recipient, per client address and overall, per day, and an address
 *   whose owner said "this wasn't me" is never mailed again.
 * - A failed send never fails the creation: the reply says whether the email went.
 * - Nothing here logs an address, a code, a token or a link.
 */
import { digestsEqual, randomHex, sha256Hex } from "./secrets.mjs";
import { json, refuse } from "./http.mjs";

export const MAX_EMAIL_LENGTH = 254;
/** How long a verification link works. */
export const VERIFY_TTL_SECONDS = 7 * 24 * 3600;
/** Sends per UTC day. */
export const SEND_LIMITS = { perRecipient: 3, perClient: 10, overall: 500 };
const SUBJECT = "Your Citadel workspace claim code";
const HEX64 = /^[0-9a-f]{64}$/;

/** The address, trimmed with its domain lower-cased, or null when it cannot be one. */
export function emailOf(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_EMAIL_LENGTH) return null;
  const m = /^([^\s@<>()[\]\\,;:"]{1,64})@([A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+)$/.exec(trimmed);
  return m ? `${m[1]}@${m[2].toLowerCase()}` : null;
}

const fragment = (fields) => Object.entries(fields).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");

export function claimMessage(cfg, slug, claim, token) {
  const claimLink = `${cfg.publicOrigin}/claim#${fragment({ slug, code: claim, v: token })}`;
  const notMe = `${cfg.publicOrigin}/claim#${fragment({ slug, "not-me": token })}`;
  const text =
    "Your new Citadel workspace is ready to claim.\n\n" +
    `Claim code: ${claim}\n\n` +
    "Open this link to claim it and become its administrator. It also confirms this email address:\n" +
    `${claimLink}\n\n` +
    "Keep the code private. It makes whoever holds it the workspace's administrator. Once you confirm this address with the link above, billing\n" +
    "can only be managed through a link emailed to this address, not with the code alone.\n\n" +
    `Didn't create a workspace? Tell us, and this address will not be emailed again:\n${notMe}\n`;
  return { subject: SUBJECT, text };
}

/**
 * Sends the claim email for `slug` to its recorded address, minting a fresh verification token.
 * `{sent: true}`, or `{sent: false, reason}` with reason one of: no-address, suppressed, limited,
 * failed. Never throws for a send that did not happen.
 */
export async function sendClaimEmail(io, cfg, { slug, tenantId, to, claim, client }) {
  const token = randomHex(32);
  const sent = await mailWithinLimits(io, { to, client, what: `the claim email for ${slug}` }, claimMessage(cfg, slug, claim, token));
  if (sent.sent) {
    const now = io.now();
    await io.store.recordVerification(slug, tenantId, await sha256Hex(token), now + VERIFY_TTL_SECONDS, now);
  }
  return sent;
}

/**
 * Sends `message` to `to` unless the address is suppressed or a daily limit is reached; the one
 * way this service mails anyone, so every message counts against the same limits.
 * `{sent: true}` or `{sent: false, reason}`; never throws for a send that did not happen.
 */
export async function mailWithinLimits(io, { to, client, what }, message) {
  if (to === null) return { sent: false, reason: "no-address" };
  const recipient = await sha256Hex(to);
  if (await io.mailLedger.suppressed(recipient)) return { sent: false, reason: "suppressed" };
  const limits = { [`to:${recipient}`]: SEND_LIMITS.perRecipient, all: SEND_LIMITS.overall };
  if (client) limits[`ip:${client}`] = SEND_LIMITS.perClient;
  if (!(await io.mailLedger.take(limits, Math.floor(io.now() / 86400)))) return { sent: false, reason: "limited" };
  try {
    await io.mail.send({ to, ...message });
  } catch (e) {
    console.error(`[control] ${what} was not sent: ${e?.message ?? e}`);
    return { sent: false, reason: "failed" };
  }
  return { sent: true };
}

const tokenOf = (body) => (typeof body?.token === "string" && HEX64.test(body.token) ? body.token : null);
const NOT_FOUND = () => refuse("not-found", "no such workspace", 404);
const BAD_LINK = () => refuse("link-invalid", "that link has expired or was replaced by a newer one", 400);

/** POST /api/tenants/:slug/verify-email {token}: confirms the address. A repeat is a success. */
export async function verifyEmail(io, slug, body) {
  const token = tokenOf(body);
  if (token === null) return BAD_LINK();
  const verified = await io.store.verifyEmail(slug, await sha256Hex(token), io.now());
  return verified ? json({ slug, email_verified: true }) : BAD_LINK();
}

/** POST /api/tenants/:slug/not-me {token}: forgets the address and never mails it again. */
export async function notMe(io, slug, body) {
  const token = tokenOf(body);
  if (token === null) return BAD_LINK();
  const email = await io.store.forgetEmail(slug, await sha256Hex(token));
  if (email === null) return BAD_LINK();
  await io.mailLedger.suppress(await sha256Hex(email), io.now());
  return json({ slug, forgotten: true });
}

/** The row for `slug`, if `claim` is its claim code. */
async function claimedRow(io, slug, claim) {
  if (typeof claim !== "string" || !HEX64.test(claim)) return null;
  const row = await io.store.holder(slug, io.now());
  if (!row || row.status !== "active" || !digestsEqual(row.claim_hash ?? "", await sha256Hex(claim))) return null;
  return row;
}

/**
 * POST /api/tenants/:slug/email {claim_code, email?}: sends the claim email again, to `email`
 * when one is given (which replaces the address) or else to the one recorded. Proof is the claim
 * code, which the caller must already hold.
 */
export async function resendEmail(io, cfg, slug, body, client) {
  const row = await claimedRow(io, slug, body?.claim_code);
  if (row === null) return NOT_FOUND();
  let to = row.owner_email;
  if (body.email !== undefined) {
    to = emailOf(body.email);
    if (to === null) return refuse("malformed-request", "email is not an address", 400);
    await io.store.setOwnerEmail(slug, row.tenant_id, to);
  }
  const sent = await sendClaimEmail(io, cfg, { slug, tenantId: row.tenant_id, to, claim: body.claim_code, client });
  return json({ slug, email_sent: sent.sent, ...(sent.sent ? {} : { email_reason: sent.reason }) });
}
