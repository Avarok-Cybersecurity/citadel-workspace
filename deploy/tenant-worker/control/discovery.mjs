/**
 * `GET /api/admission/<slug>`: whether a workspace asks for a human check before sign-in and
 * registration, and the widget's site key, for a form that has no session yet (UI
 * lib/admission/discovery.ts). Public, and it says nothing else: no plan, no counts, no names.
 *
 * `GET /api/admission`, with no workspace, is for a form that cannot know its workspace before
 * it submits (sign-in names an account, and the agent knows its server): only the site key, and
 * `required: false`, which means "not known to be required", never "not required". The server's
 * `admission_required` refusal then shows the check, with this key.
 *
 * Its answer is advisory. The tenant's admission check is what enforces the setting, and fails
 * closed; a stale "not required" costs the visitor one refused attempt that then shows the check.
 * So the answer may be cached briefly, and is.
 *
 * `GET /.well-known/citadel` on a tenant's host (and on its custom domain) is its server identity
 * document (contract well-known-citadel.schema.json): built by the tenant's kernel from its key
 * and `[identity]` (control/tenant-identity.mjs), the same bytes for the life of the object's
 * instance. Public by design: clients fetch it before they have an account. A tenant with no
 * server key answers 404, never a document under some other key.
 */
import { checkSlug } from "./slug.mjs";
import { discovery } from "./admission.mjs";
import { json, refuse } from "./http.mjs";

/** Seconds a browser may reuse an answer: an admin's change reaches new forms within this. */
export const DISCOVERY_MAX_AGE = 30;

const answer = (required, cfg) =>
  json(discovery(required, cfg.turnstileSiteKey), 200, { "cache-control": `public, max-age=${DISCOVERY_MAX_AGE}` });

/** The answer for no particular workspace: the site key alone. */
export const admissionAnywhere = (cfg) => answer(false, cfg);

/** The path a tenant's host serves its identity document at. */
export const WELL_KNOWN_PATH = "/.well-known/citadel";

/** Seconds a fetcher may reuse the document: it is re-issued only when the object restarts. */
export const WELL_KNOWN_MAX_AGE = 300;

/** `{row}` for a tenant a request may reach, or `{refusal}`: unknown and pending ones are not found. */
export async function reachable(io, slug) {
  if (!checkSlug(slug).ok) return { refusal: refuse("not-found", "no such workspace", 404) };
  const row = await io.store.holder(slug, io.now());
  if (!row || row.status === "pending") return { refusal: refuse("not-found", "no such workspace", 404) };
  if (row.status === "suspended") return { refusal: refuse("suspended", "this workspace is suspended", 403) };
  return { row };
}

export async function admissionOf(io, cfg, slug) {
  const { refusal } = await reachable(io, slug);
  return refusal ?? answer(await io.tenant(slug).admissionRequired(), cfg);
}

export async function wellKnownOf(io, slug) {
  const { refusal } = await reachable(io, slug);
  if (refusal) return refusal;
  const document = await io.tenant(slug).wellKnown();
  if (document === null) return refuse("not-found", "this workspace publishes no server identity", 404);
  return new Response(document, {
    headers: {
      "content-type": "application/json",
      "cache-control": `public, max-age=${WELL_KNOWN_MAX_AGE}`,
      "x-content-type-options": "nosniff",
    },
  });
}
