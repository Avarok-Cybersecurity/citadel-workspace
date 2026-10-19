/**
 * The billing state the public answers carry: `GET /api/tenants/<slug>/status`, discovery
 * (`GET /api/admission/<slug>`) and the tenant host (dispatch.mjs), so the UI can show the pay
 * screen. Payment required is a suspended tenant with a tenant_dunning row (control/dunning.mjs);
 * a suspension without one (a paused subscription) is plain "suspended".
 */
import { json, refuse } from "./http.mjs";

const isoDate = (seconds) => new Date(seconds * 1000).toISOString().slice(0, 10);

/** `{state: "active"}` or `{state: "payment_required", since, purge_at}` (seconds, UTC): a plain object to spread into. */
export async function billingOf(io, row) {
  const owing = row.status === "suspended" ? await io.dunning.get(row.tenant_id) : null;
  return owing === null ? { state: "active" } : { state: "payment_required", since: owing.since, purge_at: owing.purge_at };
}

/** The 403 for a suspended `row`: payment-required with its billing state, else plain suspended. */
export async function suspendedAnswer(io, row) {
  const billing = await billingOf(io, row);
  if (billing.state !== "payment_required") return refuse("suspended", "this workspace is suspended", 403);
  const detail = `payment is required: this workspace is closed until its invoice is paid, and is deleted on ${isoDate(billing.purge_at)} (UTC) if it is not`;
  return json({ error: "payment-required", detail, billing }, 403);
}
