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

export async function admissionOf(io, cfg, slug) {
  if (!checkSlug(slug).ok) return refuse("not-found", "no such workspace", 404);
  const row = await io.store.holder(slug, io.now());
  if (!row || row.status === "pending") return refuse("not-found", "no such workspace", 404);
  if (row.status === "suspended") return refuse("suspended", "this workspace is suspended", 403);
  return answer(await io.tenant(slug).admissionRequired(), cfg);
}
