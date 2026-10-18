/**
 * Usage alerts, from the monitor (control/monitor.mjs) once per run per active tenant: for each
 * dimension the thresholds due now (billing/thresholds.mjs) minus those already recorded this
 * period (tenant_alerts), each announced by ONE email to the Stripe customer's address, read
 * from Stripe at send time and never stored. A workspace with no customer or no address (Free)
 * is told in-app only, by the alert level on its status answer; that is logged and recorded.
 * A row is recorded only AFTER its email was accepted, so a failed send is retried next run.
 */
import { dueAlerts } from "../../../billing/thresholds.mjs";
import { alertMail } from "./alert-mail.mjs";
import { billedUnitOf } from "./dimensions.mjs";
import { POLICY } from "./policy.mjs";
import { stripe } from "./stripe.mjs";

/** `meters` is the tenant object's `meters()` answer. */
export async function sendAlerts(io, cfg, row, meters) {
  const periodStart = meters.period.start;
  let address;
  for (const d of meters.dimensions) {
    const scale = billedUnitOf(d.id)?.size ?? 1;
    const sent = await io.alerts.sent(row.tenant_id, periodStart, d.id);
    const due = dueAlerts({
      policy: POLICY, dimension: d.id, used: d.used / scale, included: d.included / scale, overage_billing: meters.overage_billing,
      state: d.state, terminate_at: d.terminate_at, now: io.nowMs(), sent,
    });
    for (const key of due) {
      address ??= await customerAddress(io, cfg, row);
      if (address === null) {
        console.log(`[alerts] ${row.slug}: ${d.id} ${key}, in-app only (no billing address)`);
      } else {
        if (io.mail === null) throw new Error("this deployment cannot send email (MAIL_FROM and the MAIL binding): usage alerts are not sent");
        await io.mail.send({ to: address, ...alertMail({ slug: row.slug, dimension: d.id, key, overage_billing: meters.overage_billing }) });
        console.log(`[alerts] ${row.slug}: ${d.id} ${key} emailed`);
      }
      await io.alerts.record(row.tenant_id, periodStart, d.id, key, io.now());
    }
  }
}

/** The Stripe customer's email, or null for a workspace with no customer or none on file. */
async function customerAddress(io, cfg, row) {
  if (!row.stripe_customer) return null;
  if (!cfg.stripeKey) throw new Error("STRIPE_SECRET_KEY is not set: the billing address for alerts cannot be read");
  const customer = await stripe(io, cfg.stripeKey, "GET", `/customers/${encodeURIComponent(row.stripe_customer)}`);
  return typeof customer.email === "string" && customer.email ? customer.email : null;
}
