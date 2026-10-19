/**
 * Overage per metered dimension (tiers.json `metered`), as the monitor reports it to Stripe's
 * Billing Meters. For each dimension: the period's usage beyond what the plan includes, in whole
 * billed units; nothing below pricing-model.json `overage_min` (a usage invoice under Stripe's
 * fixed fee is forgiven); reported only for a tenant with overage billing on and its usage-only
 * subscription in place -- otherwise logged once per run as not billed (the termination of an
 * overage-off tenant is control/termination.mjs's). Each report is an outbox (usage-store.mjs):
 * opened, sent under an identifier naming the units it covers, and only then closed.
 */
import model from "../../../billing/pricing-model.json";
import { METERED, METERING } from "./plans.mjs";
import { stripe } from "./stripe.mjs";

/**
 * How each metered dimension is measured: `used` and `included` in its base unit (bytes,
 * appends), `unitSize(m)` base units to a billed unit (tiers.json's own figures: metering.gb_bytes,
 * the entry's quantity_per_unit), `stored` the included figure as tenant_usage keeps it. `prefix`
 * begins its meter events' identifier (relay's predates the others and is kept, so an event in
 * flight at a deploy is still deduplicated).
 */
const MEASURES = {
  "relay-overage": {
    prefix: "relay", unitSize: () => METERING.gb_bytes, used: (p) => p.bytes_in,
    included: (e) => e.relay_gb_included * METERING.gb_bytes, stored: (e) => e.relay_gb_included,
  },
  "document-appends": {
    prefix: "document-appends", unitSize: (m) => m.quantityPerUnit, used: (p) => p.appends,
    included: (e) => e.document_appends_included, stored: (e) => e.document_appends_included,
  },
};

/** `[{id, prefix, eventName, unitSize, min, sold, offeredOn, used(period), included(entitlements), stored}]`, in tiers.json order. */
export const DIMENSIONS = METERED.map((m) => {
  const measure = MEASURES[m.id];
  if (!measure) throw new Error(`tiers.json metered ${m.id} has no measure in control/overage-report.mjs`);
  const unitSize = measure.unitSize(m);
  if (!Number.isInteger(unitSize) || unitSize <= 0) throw new Error(`tiers.json metered ${m.id}: the quantity one billed unit covers is a positive integer`);
  const min = model.overage_min?.[m.id];
  if (!Number.isInteger(min) || min < 0) throw new Error(`pricing-model.json overage_min.${m.id} is a non-negative integer`);
  return Object.freeze({ ...measure, unitSize, id: m.id, eventName: m.eventName, min, sold: m.sold, offeredOn: m.offeredOn });
});

/** Whole units of `used` beyond `included` (both in the dimension's base unit), never negative. */
export const overageUnits = (used, included, unitSize) => Math.floor(Math.max(0, used - included) / unitSize);

/** The units to report for a period: its overage, or 0 while that is below the forgiven minimum. */
export const billableUnits = (overage, min) => (overage < min ? 0 : overage);

/** Whether the tenant's overage is billed: overage billing on and the usage subscription held. */
export const overageBilled = (row) => row.overage_billing === 1 && Boolean(row.usage_subscription);

/**
 * Each dimension's figures for one period: `{id, included, overage, billable}` -- `included` as
 * the usage store keeps it, `overage` the whole units beyond it, `billable` what may be reported.
 */
export const periodFigures = (period, want) =>
  DIMENSIONS.map((d) => {
    const overage = overageUnits(d.used(period), d.included(want), d.unitSize);
    return { id: d.id, included: d.stored(want), overage, billable: billableUnits(overage, d.min) };
  });

/** Records the tenant's periods and reports what is new and billable; one log line when it is not billed. */
export async function reportOverage(io, cfg, row, want, periods) {
  const unbilled = new Set();
  const unapproved = new Set();
  for (const period of periods) {
    const figures = periodFigures(period, want);
    const sent = await io.usage.record(row.tenant_id, period, figures, io.now());
    for (const f of figures) {
      const dim = DIMENSIONS.find((d) => d.id === f.id);
      if (sent[f.id].pending === null && f.billable <= sent[f.id].reported) continue;
      // Recorded, never reported, while tiers.json holds the entry proposed (plans.mjs METERED).
      if (!dim.sold) {
        unapproved.add(`${f.id} ${f.billable}`);
        continue;
      }
      if (!dim.offeredOn(row.tier) || !overageBilled(row)) {
        unbilled.add(`${f.id} ${f.billable}`);
        continue;
      }
      await report(io, cfg, row, dim, period.period_start, f.billable);
    }
  }
  if (unapproved.size) {
    console.warn(`[monitor] ${row.slug}: overage not billed (its price is not approved in billing/tiers.json): ${[...unapproved].join(", ")}`);
  }
  if (unbilled.size) {
    console.warn(`[monitor] ${row.slug}: overage not billed (${row.tier}, overage billing ${row.overage_billing ? "on, no usage subscription" : "off"}): ${[...unbilled].join(", ")}`);
  }
}

async function report(io, cfg, row, dim, periodStart, units) {
  if (!cfg.stripeKey) throw new Error(`STRIPE_SECRET_KEY is not set: ${dim.id} cannot be reported`);
  if (!row.stripe_customer) throw new Error(`a ${row.tier} tenant with no Stripe customer is over its ${dim.id}`);
  const { reported, pending } = await io.usage.openReport(row.tenant_id, periodStart, dim.id, units);
  if (pending === null) return; // another run closed it meanwhile
  const identifier = `${dim.prefix}-${row.tenant_id}-${periodStart}-${reported}-${pending}`;
  await stripe(
    io,
    cfg.stripeKey,
    "POST",
    "/billing/meter_events",
    { event_name: dim.eventName, "payload[stripe_customer_id]": row.stripe_customer, "payload[value]": String(pending - reported), identifier },
    identifier,
  );
  await io.usage.closeReport(row.tenant_id, periodStart, dim.id, pending);
}
