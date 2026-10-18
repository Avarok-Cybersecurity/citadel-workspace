/**
 * The usage monitor, run by the Worker's Cron trigger (`scheduled()` in worker.mjs). For every
 * active tenant it:
 *   1. repairs entitlement drift: the object is given what the registry says it should enforce
 *      (a webhook whose object write and D1 batch parted ways, or an object provisioned before a
 *      limit existed);
 *   2. copies the object's recent periods' totals into D1 (`tenant_usage`), overwriting;
 *   3. reports each metered dimension's overage (relay GB, thousands of document appends) to
 *      Stripe's Billing Meters, once, through an outbox (control/overage-report.mjs): the event is
 *      sent under an identifier naming the units it covers, and only then is the report recorded
 *      (the webhook's rule: record AFTER the write it guards);
 *   4. takes the census of the object's accounts by auth-record version (control/auth-versions.mjs):
 *      counts only, logged and kept in D1, warning while any legacy Argon2 account remains.
 * The object is authoritative for its own limits; a missed run delays a report, nothing more.
 */
import { AUTH_VERSION_KEYS } from "./auth-versions.mjs";
import { entitlements, METERING } from "./plans.mjs";
import { overageUnits, reportOverage } from "./overage-report.mjs";

/** Whole GB of metered usage beyond what the tier includes. */
export const overageGb = (bytes, includedGb) => overageUnits(bytes, includedGb * METERING.gb_bytes, METERING.gb_bytes);

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
  await reportOverage(io, cfg, row, want, seen.periods);
  await census(io, row, object);
}

/** The tenant's accounts by auth-record version: counts only, never a username or a CID. */
async function census(io, row, object) {
  const counts = await object.authVersions();
  await io.authVersions.record(row.tenant_id, counts, io.now());
  console.log(`[monitor] ${row.slug}: auth records ${AUTH_VERSION_KEYS.map((k) => `${k}=${counts[k]}`).join(" ")}`);
  if (counts.legacy_argon > 0) console.warn(`[monitor] ${row.slug}: ${counts.legacy_argon} legacy Argon2 account(s) remain`);
  if (counts.undecodable > 0) console.warn(`[monitor] ${row.slug}: ${counts.undecodable} account record(s) could not be read for the census`);
}

function sameEntitlements(have, want) {
  if (have === null || typeof have !== "object") return false;
  const keys = new Set([...Object.keys(have), ...Object.keys(want)]);
  return [...keys].every((k) => have[k] === want[k]);
}
