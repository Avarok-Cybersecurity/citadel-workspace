/**
 * The three metered dimensions a workspace is alerted about (docs/plans/billing-automation.md G),
 * measured from the object's enforced entitlements and its current period's meter. Pure.
 *
 *   relay-overage     used: bytes in, in tiers.json's GB; included: relay_gb_included
 *   document-appends  used: appends; included: document_appends_included
 *   storage           used: the object's stored bytes; included: storage_gb in bytes. A hard cap
 *                     the kernel enforces at upload: alerted about, never terminated.
 */
import table from "../../../billing/tiers.json";
import { METERING } from "./plans.mjs";

/** Dimension ids, in the order answers list them. */
export const DIMENSION_IDS = ["relay-overage", "document-appends", "storage"];

/**
 * `[{id, unit, used, included, terminates}]`. `snapshot` is the meter's (meter.mjs), `storedBytes`
 * the object's SQLite size.
 */
export function measure(entitlements, snapshot, storedBytes) {
  for (const k of ["relay_gb_included", "document_appends_included", "storage_gb"]) {
    if (!Number.isFinite(entitlements[k])) throw new Error(`the tenant's entitlements carry no ${k}`);
  }
  if (!Number.isFinite(snapshot.appends)) throw new Error("the meter carries no appends total");
  return [
    { id: "relay-overage", unit: "GB", used: snapshot.bytes_in / METERING.gb_bytes, included: entitlements.relay_gb_included, terminates: true },
    { id: "document-appends", unit: "appends", used: snapshot.appends, included: entitlements.document_appends_included, terminates: true },
    { id: "storage", unit: "bytes", used: storedBytes, included: entitlements.storage_gb * METERING.gb_bytes, terminates: false },
  ];
}

/**
 * How many of a dimension's `used` units one billed unit is, from tiers.json's metered `unit`
 * ("GB" is one GB, which relay is measured in; "1,000 appends" is 1000 appends), or null for a
 * dimension that is never billed beyond its quota (storage).
 */
export function billedUnitOf(id) {
  const metered = (table.metered ?? []).find((m) => m.id === id);
  if (!metered) return null;
  const leading = /^([0-9][0-9,]*)\s/.exec(metered.unit);
  return { size: leading ? Number(leading[1].replaceAll(",", "")) : 1, unit: metered.unit };
}
