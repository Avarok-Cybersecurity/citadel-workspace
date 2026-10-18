/**
 * The Customer Terms a workspace's creator accepts. The text and version are the crate's
 * (citadel-workspace-types/src/terms.rs, SSOT); the Worker ships no text and needs only the
 * version to refuse a creation that accepted another. scripts/check-customer-terms-version-parity.mjs
 * fails the build if this constant and the crate's disagree.
 */
import { json, refuse } from "./http.mjs";

export const CUSTOMER_TERMS_VERSION = 2;

/** The version the creator accepted, or the refusal: `{version}` or `{error: Response}`. */
export function readAcceptedTerms(body) {
  const accepted = body.accepted_customer_terms_version;
  if (accepted === undefined) {
    return { error: refuse("customer-terms-required", `accepted_customer_terms_version is required; the current version is ${CUSTOMER_TERMS_VERSION}`, 400) };
  }
  if (!Number.isInteger(accepted)) {
    return { error: refuse("malformed-request", "accepted_customer_terms_version is an integer", 400) };
  }
  if (accepted !== CUSTOMER_TERMS_VERSION) {
    return { error: refuse("customer-terms-stale", `version ${accepted} is not current; the current version is ${CUSTOMER_TERMS_VERSION}`, 409) };
  }
  return { version: accepted };
}

/**
 * Before the billing portal opens: a workspace whose latest accepted Customer Terms are older than
 * the current version must accept the current ones first (the claim-code holder, in Plan &
 * billing). Carrying `accepted_customer_terms_version` equal to the current version records the
 * acceptance and lets the portal open. Null when the portal may open; else the refusal.
 */
export async function portalTermsRefusal(io, row, body) {
  const latest = await io.store.latestCustomerTermsVersion(row.tenant_id);
  if (latest !== null && latest >= CUSTOMER_TERMS_VERSION) return null;
  const accepted = body.accepted_customer_terms_version;
  if (accepted !== undefined && !Number.isInteger(accepted)) {
    return refuse("malformed-request", "accepted_customer_terms_version is an integer", 400);
  }
  if (accepted !== CUSTOMER_TERMS_VERSION) {
    return json({ error: "customer-terms-stale", current: CUSTOMER_TERMS_VERSION, document: "customer-terms" }, 409);
  }
  await io.store.acceptCustomerTerms(row.tenant_id, row.slug, CUSTOMER_TERMS_VERSION, io.now());
  return null;
}
