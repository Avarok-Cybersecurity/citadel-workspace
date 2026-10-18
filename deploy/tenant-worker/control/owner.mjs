/**
 * The claim-code proof the owner's routes share (the billing portal, the usage meters): the
 * workspace's row when `body.claim_code` is its claim code. One refusal for "no such workspace"
 * and "wrong code", so no route here is an oracle for either.
 */
import { checkSlug } from "./slug.mjs";
import { digestsEqual, sha256Hex } from "./secrets.mjs";
import { refuse } from "./http.mjs";

/** `{row}`, or `{error: Response}`: 404 for a slug that cannot exist, else 403 not-owner. */
export async function ownedRow(io, slug, body) {
  if (!checkSlug(slug).ok) return { error: refuse("not-found", "no such workspace", 404) };
  const row = await io.store.holder(slug, io.now());
  const presented = typeof body.claim_code === "string" && /^[0-9a-f]{64}$/.test(body.claim_code) ? body.claim_code : null;
  if (!row || !presented || !digestsEqual(await sha256Hex(presented), row.claim_hash)) {
    return { error: refuse("not-owner", "that claim code does not own this workspace", 403) };
  }
  return { row };
}
