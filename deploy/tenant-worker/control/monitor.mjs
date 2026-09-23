/**
 * The usage monitor, run by the Worker's Cron trigger (`scheduled()` in worker.mjs). For every
 * active tenant it:
 *   1. repairs entitlement drift: the object is given what the registry says it should enforce
 *      (a webhook whose object write and D1 batch parted ways, or an object provisioned before a
 *      limit existed);
 *   2. copies the object's recent periods' totals into D1 (`tenant_usage`), overwriting;
 *   3. reports relay beyond the tier's included GB to Stripe's Billing Meter, in whole GB, once:
 *      an outbox row is opened, the event sent under an identifier naming the GB it covers, and
 *      only then is the report recorded (the webhook's rule: record AFTER the write it guards).
 * The object is authoritative for its own limits; a missed run delays a report, nothing more.
 */
import { entitlements, METERING, OVERAGE_EVENT, overageBilledOn, overageSoldWith } from "./plans.mjs";
import { stripe } from "./stripe.mjs";

/** Whole GB of metered usage beyond what the tier includes. */
export const overageGb = (bytes, includedGb) => Math.max(0, Math.floor(bytes / METERING.gb_bytes) - includedGb);

export async function runMonitor(io, cfg) {
  const failures = [];
  for (const row of await io.store.active()) {
    try {
      await monitorTenant(io, cfg, row);
    } catch (e) {
      failures.push(`${row.slug}: ${e?.message ?? e}`);
    }
  }
  // Every tenant is visited whatever one of them does; the run still fails, loudly, if any did.
  if (failures.length) throw new Error(`usage monitor: ${failures.length} tenant(s) failed: ${failures.join("; ")}`);
}

async function monitorTenant(io, cfg, row) {
  const object = io.tenant(row.slug);
  const want = entitlements(row);
  const seen = await object.usage();
  if (!sameEntitlements(seen.entitlements, want)) {
    console.warn(`[monitor] ${row.slug}: the object's entitlements differ from the registry's; pushing them`);
    await object.setEntitlements(want);
  }
  for (const period of seen.periods) {
    const overage = overageGb(period.bytes_in, want.relay_gb_included);
    const sent = await io.usage.record(row.tenant_id, period, want.relay_gb_included, overage, io.now());
    if (sent.pending === null && overage <= sent.reported) continue;
    if (!overageSoldWith(row.tier, row.interval) && !(row.usage_subscription && overageBilledOn(row.tier))) {
      // Free, or a yearly plan whose usage-only subscription does not exist yet.
      console.warn(`[monitor] ${row.slug}: ${overage} GB over the ${row.tier}/${row.interval} relay, which is not billed`);
      continue;
    }
    await report(io, cfg, row, period.period_start, overage);
  }
}

async function report(io, cfg, row, periodStart, overage) {
  if (!cfg.stripeKey) throw new Error("STRIPE_SECRET_KEY is not set: relay overage cannot be reported");
  if (!row.stripe_customer) throw new Error(`a ${row.tier} tenant with no Stripe customer is over its relay`);
  const { reported, pending } = await io.usage.openReport(row.tenant_id, periodStart, overage);
  if (pending === null) return; // another run closed it meanwhile
  const identifier = `relay-${row.tenant_id}-${periodStart}-${reported}-${pending}`;
  await stripe(
    io,
    cfg.stripeKey,
    "POST",
    "/billing/meter_events",
    {
      event_name: OVERAGE_EVENT,
      "payload[stripe_customer_id]": row.stripe_customer,
      "payload[value]": String(pending - reported),
      identifier,
    },
    identifier,
  );
  await io.usage.closeReport(row.tenant_id, periodStart, pending);
}

function sameEntitlements(have, want) {
  if (have === null || typeof have !== "object") return false;
  const keys = new Set([...Object.keys(have), ...Object.keys(want)]);
  return [...keys].every((k) => have[k] === want[k]);
}
