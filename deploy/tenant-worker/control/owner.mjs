/**
 * The one proof the owner's routes (the billing portal, the overage-billing switch) accept: the
 * workspace's claim code. Pure but for the registry read.
 */
import { checkSlug } from "./slug.mjs";
import { digestsEqual, sha256Hex } from "./secrets.mjs";
import { refuse } from "./http.mjs";

/** `{row}` when `body.claim_code` owns `slug`, else `{error}` (a Response). */
export async function ownedRow(io, slug, body) {
  if (!checkSlug(slug).ok) return { error: refuse("not-found", "no such workspace", 404) };
  const row = await io.store.holder(slug, io.now());
  const presented = typeof body.claim_code === "string" && /^[0-9a-f]{64}$/.test(body.claim_code) ? body.claim_code : null;
  // One answer for "no such workspace" and "wrong code", so the route is no oracle for either.
  if (!row || !presented || !digestsEqual(await sha256Hex(presented), row.claim_hash)) {
    return { error: refuse("not-owner", "that claim code does not own this workspace", 403) };
  }
  return { row };
}
