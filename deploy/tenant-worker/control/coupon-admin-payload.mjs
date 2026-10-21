/**
 * The payload of a verified coupon-admin request, checked field by field (pure). The signature
 * says who sent it; this says it is well formed, so nothing past here builds on an unchecked
 * field. Every field is required: an issue names `template` and `grant_id` both, one null.
 *
 *   { nonce, expires_at_ms, audience?, action }
 *   action: { kind: "issue_coupon", code, template, grant_id, available_on, intervals,
 *             max_redemptions, redeem_by_ms, note }
 *         | { kind: "revoke_coupon", code, also_revoke_grants }
 *         | { kind: "list_coupons" }
 *         | { kind: "list_redemptions", code }
 */
import { checkCoupon, MAX_NOTE_LENGTH } from "../../../billing/coupons-catalogue.mjs";
import { COUPONS } from "./plans.mjs";
import { normaliseCode } from "./coupon-rules.mjs";

const NONCE = /^[0-9a-f]{32}$/;
const ACTION_FIELDS = {
  issue_coupon: ["kind", "code", "template", "grant_id", "available_on", "intervals", "max_redemptions", "redeem_by_ms", "note"],
  revoke_coupon: ["kind", "code", "also_revoke_grants"],
  list_coupons: ["kind"],
  list_redemptions: ["kind", "code"],
};

function exactly(value, fields) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "is not an object";
  const extra = Object.keys(value).filter((k) => !fields.includes(k));
  if (extra.length) return `has unknown fields: ${extra.join(", ")}`;
  const missing = fields.filter((k) => !(k in value));
  return missing.length ? `lacks ${missing.join(", ")}` : null;
}

/** A code given exactly as the shape has it: the admin tool upper-cases, so nothing is guessed here. */
const codeOf = (value) => (typeof value === "string" && normaliseCode(value) === value ? value : null);

/** `{nonce, expires_at_ms, action}` or `{error}` (the detail of a 400). `audience` is the control host. */
export function readAdminPayload(payload, audience, nowMs) {
  const fields = ["nonce", "expires_at_ms", "action"];
  const shape = exactly(payload, payload && "audience" in payload ? [...fields, "audience"] : fields);
  if (shape) return { error: `the payload ${shape}` };
  if ("audience" in payload && payload.audience !== audience) return { error: "the payload is for another audience" };
  if (typeof payload.nonce !== "string" || !NONCE.test(payload.nonce)) return { error: "nonce is 32 lowercase hex characters" };
  if (!Number.isInteger(payload.expires_at_ms) || payload.expires_at_ms <= nowMs) return { error: "expires_at_ms is a future instant" };
  const action = payload.action;
  const want = ACTION_FIELDS[action?.kind];
  if (!want) return { error: `action.kind is one of ${Object.keys(ACTION_FIELDS).join(", ")}` };
  const actionShape = exactly(action, want);
  if (actionShape) return { error: `the ${action.kind} action ${actionShape}` };
  if ("code" in action && codeOf(action.code) === null) return { error: "code is an upper-case code of the catalogue's code_shape" };
  if (action.kind === "revoke_coupon" && typeof action.also_revoke_grants !== "boolean") return { error: "also_revoke_grants is true or false" };
  if (action.kind === "issue_coupon") {
    const issue = readIssue(action, nowMs);
    if (issue.error) return issue;
  }
  return { nonce: payload.nonce, expires_at_ms: payload.expires_at_ms, action };
}

/** The issue's coupon, checked by the catalogue's own `checkCoupon` (the one static codes pass). */
function readIssue(action, nowMs) {
  if (typeof action.note !== "string" || action.note.length > MAX_NOTE_LENGTH) return { error: `note is a string of at most ${MAX_NOTE_LENGTH} characters` };
  if (action.redeem_by_ms !== null && (!Number.isInteger(action.redeem_by_ms) || action.redeem_by_ms <= nowMs)) {
    return { error: "redeem_by_ms is a future instant, or null" };
  }
  try {
    checkCoupon(issuedCoupon(action), COUPONS, { allowUnlimited: true });
  } catch (e) {
    return { error: e.message };
  }
  return {};
}

/** The coupon an issue action describes, in the catalogue's shape. */
export const issuedCoupon = (action) => ({
  code: action.code, template: action.template, grant_id: action.grant_id, available_on: action.available_on,
  intervals: action.intervals, max_redemptions: action.max_redemptions, redeem_by_ms: action.redeem_by_ms,
});
