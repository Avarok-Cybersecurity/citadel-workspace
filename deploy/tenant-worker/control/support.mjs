/**
 * Avarok support's read API (plan section 3), for `tools/telemetry-read`:
 *
 *   POST /api/support/grants      -> 200 { grants: [{ tenant, until_ms }] }
 *   POST /api/support/telemetry   -> 200 the tenant kernel's ListTelemetry response, as JSON
 *   POST /api/support/bugs        -> 200 { reports: [{ id, tenant, surface, contactable, received_at_ms }] }
 *   POST /api/support/bug         -> 200 { report: { id, tenant, surface, contact, body, received_at_ms } }
 *
 * Each body is a signed support request (citadel-support-signature): `{ payload, signature }`,
 * an ML-DSA-65 signature by the key in CITADEL_SUPPORT_MLDSA_PUBLIC_KEY over the payload, whose
 * action must be the route's. The order is the point: the signature is verified first (so an
 * unsigned request stores nothing and reaches no tenant), then its nonce is claimed in D1 (so it
 * is served once), and only then is a tenant's object asked. That object serves the query only
 * while its admin's grant is on and unexpired, and audits it (`support_list_telemetry`).
 *
 * Not a browser API: no Origin is required, and no CORS header is ever sent.
 */
import { json, readText, refuse } from "./http.mjs";
import { checkSlug } from "./slug.mjs";
import { REPORT_ID } from "./bug-reports.mjs";

/** `{ payload, signature }`: a payload of at most 4096 bytes and a 6618-character signature. */
const SUPPORT_BODY_LIMIT = 12288;

const ROUTES = { grants: "list_grants", telemetry: "fetch_telemetry", bugs: "list_bug_reports", bug: "fetch_bug_report" };

/** The route `parts` (after "api") name, or null when they are not a support route. */
export const supportRoute = (method, parts) =>
  method === "POST" && parts.length === 2 && parts[0] === "support" && Object.hasOwn(ROUTES, parts[1]) ? parts[1] : null;

export async function serveSupport(io, cfg, request, route) {
  if (cfg.supportPublicKey === null) {
    return refuse("unconfigured", "support access needs CITADEL_SUPPORT_MLDSA_PUBLIC_KEY", 503);
  }
  const read = await readText(request, SUPPORT_BODY_LIMIT);
  if (read.error) return read.error;
  const nowMs = io.nowMs();
  const verified = io.verifySupport(cfg.supportPublicKey, read.text, cfg.controlHost, nowMs);
  if (!verified.ok) return refuse("unauthorized", verified.refusal, 401);
  if (verified.action !== ROUTES[route]) {
    return refuse("wrong-route", `a ${verified.action} request is not served at /api/support/${route}`, 400);
  }
  if (!(await io.support.claimNonce(verified.nonce, verified.expires_at_ms, nowMs))) {
    return refuse("replayed", "this request has already been served", 409);
  }
  if (route === "grants") return json({ grants: await io.support.activeGrants(nowMs) });
  if (route === "bugs") return json({ reports: await io.bugReports.list(verified.since_ms, nowMs) });
  if (route === "bug") return fetchBugReport(io, verified.id, nowMs);
  return fetchTelemetry(io, verified, nowMs);
}

async function fetchBugReport(io, id, nowMs) {
  const report = REPORT_ID.test(id) ? await io.bugReports.get(id, nowMs) : null;
  return report === null ? refuse("not-found", "no such report, or it is past its 90 days", 404) : json({ report });
}

async function fetchTelemetry(io, verified, nowMs) {
  const slug = verified.tenant;
  if (!checkSlug(slug).ok) return refuse("not-found", "no such workspace", 404);
  const row = await io.store.holder(slug, io.now());
  if (!row || row.status !== "active") return refuse("not-found", "no active workspace by that name", 404);
  const answer = await io.tenant(slug).supportListTelemetry(verified.query, nowMs);
  return new Response(answer.body, {
    status: answer.served ? 200 : 403,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
