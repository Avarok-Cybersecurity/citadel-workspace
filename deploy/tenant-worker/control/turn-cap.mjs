/**
 * The per-member ceiling on reported TURN bytes. Only a member's own agent sees its TURN traffic,
 * so the tenant meters what agents report (server-wasm turn.rs) — and a report is a claim. With
 * automatic overage billing, an agent claiming without bound would bill the workspace's owner.
 * Each member's reports are counted per clock hour and held to billing/tiers.json
 * `paths.turn_gb_per_member_hour`; a report that would pass it is refused whole, with its reason,
 * and recorded (meter.mjs `turn_refused_bytes`), never clamped.
 *
 * `admitTurn` decides and is pure; `TurnIntake` holds each member's hour and is what the node
 * calls. The hours live with the running node: a node that starts again starts every member's
 * hour again, which at most doubles one hour's ceiling.
 */
import table from "../../../billing/tiers.json";
import { METERING } from "./plans.mjs";

const HOUR_MS = 60 * 60 * 1000;
const perHourGb = table.paths?.turn_gb_per_member_hour;
if (!Number.isInteger(perHourGb) || perHourGb <= 0) throw new Error("tiers.json paths.turn_gb_per_member_hour is a positive whole number of GB");

/** The ceiling, in bytes, one member's reports may reach in one clock hour. */
export const TURN_BYTES_PER_MEMBER_HOUR = perHourGb * METERING.gb_bytes;

/**
 * Whether a member whose hour so far is `window` (`{hour, counted}`, or null for none) may have
 * `bytes` more counted at `nowMs` under `capBytes`. `{admitted: true, window}` with the member's
 * new hour, or `{admitted: false, window, refusal}` with it unchanged and the typed reason
 * (`TurnUsageRefusal::MemberHourlyCap`).
 */
export function admitTurn(window, bytes, nowMs, capBytes) {
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error(`TURN usage is a byte count (${JSON.stringify(bytes)})`);
  const hour = Math.floor(nowMs / HOUR_MS);
  const current = window !== null && window.hour === hour ? window : { hour, counted: 0 };
  if (current.counted + bytes > capBytes) {
    return {
      admitted: false,
      window: current,
      refusal: { MemberHourlyCap: { cap_bytes: capBytes, counted_bytes: current.counted, claimed_bytes: bytes } },
    };
  }
  return { admitted: true, window: { hour, counted: current.counted + bytes } };
}

/**
 * The node's TURN usage host (server-wasm turn.rs `TurnUsageHost`): `record(userId, bytes)`
 * counts an admitted report in `meter()` and returns null, or records the refused claim and
 * returns the refusal as JSON for the kernel to answer with. `meter()` is the object's current
 * meter, rolled to the period `nowMs()` falls in; `capBytes` is `TURN_BYTES_PER_MEMBER_HOUR`.
 */
export class TurnIntake {
  constructor(meter, nowMs, capBytes) {
    this.meter = meter;
    this.nowMs = nowMs;
    this.capBytes = capBytes;
    this.windows = new Map();
  }

  record(userId, bytes) {
    const decided = admitTurn(this.windows.get(userId) ?? null, bytes, this.nowMs(), this.capBytes);
    this.windows.set(userId, decided.window);
    const meter = this.meter();
    if (decided.admitted) {
      meter.turn(bytes);
      return null;
    }
    meter.turnRefused(bytes);
    console.warn(`[tenant] TURN usage report refused: member ${userId} claimed ${bytes} bytes over the hourly ceiling (${JSON.stringify(decided.refusal)})`);
    return JSON.stringify(decided.refusal);
  }
}
