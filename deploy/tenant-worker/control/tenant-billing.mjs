/**
 * The tenant object's side of overage-off terminations (docs/plans/billing-automation.md G2, G3):
 * each dimension's state this period, and when each quota was first seen reached with overage
 * billing off. One key-value entry, `{ period_start, crossed: { <dimension>: ms } }`, keyed by the
 * meter's period: when meter.mjs `adopt` moves to a new period the record no longer matches and
 * every dimension starts again from "ok".
 *
 * A crossing is recorded when it is first observed: on a relay mint, a usage read, a status or
 * discovery answer, or the monitor's run (every 15 minutes), whichever comes first.
 */
import { measure } from "./dimensions.mjs";
import { enforcedEntitlements } from "./plans.mjs";
import { POLICY } from "./policy.mjs";
import { capOf, terminationOf } from "./termination.mjs";
import { quotaReached } from "../../../billing/thresholds.mjs";

const KEY = "billing:crossed";

/**
 * What `object` (the WorkspaceServer) is judged from now: its enforced plan, its meter's current
 * period after `roll(now)` moves it on, and its stored bytes (the SQLite database's size).
 */
export function currentOf(object, roll) {
  const now = Date.now();
  roll(now);
  const entitlements = enforcedEntitlements(object.provisioning.summary().entitlements);
  return { entitlements, snapshot: object.meter.snapshot(now), storedBytes: object.ctx.storage.sql.databaseSize };
}

export class TenantBilling {
  /**
   * `io.nowMs()` is the clock terminations are judged by (a test moves it, as ice.test.mjs moves
   * the minter's). `current()` is `{entitlements, snapshot, storedBytes}`: the enforced
   * entitlements, the meter's current period's snapshot, the object's stored bytes.
   */
  constructor(storage, io, current) {
    this.storage = storage;
    this.io = io;
    this.current = current;
    this.record = null;
  }

  async load() {
    this.record = (await this.storage.get(KEY)) ?? null;
  }

  /** `{period, overage_billing, dimensions: [{id, unit, used, included, state, terminate_at}]}`. */
  async meters() {
    const { entitlements, snapshot, storedBytes } = this.current();
    const overage = entitlements.overage_billing;
    if (typeof overage !== "boolean") throw new Error("the tenant's entitlements carry no overage_billing");
    const now = this.io.nowMs();
    const measured = measure(entitlements, snapshot, storedBytes);
    let record = this.record?.period_start === snapshot.period_start ? this.record : { period_start: snapshot.period_start, crossed: {} };
    const newly = measured.filter((d) => d.terminates && !overage && quotaReached(d.used, d.included) && record.crossed[d.id] === undefined);
    if (newly.length) {
      record = { ...record, crossed: { ...record.crossed, ...Object.fromEntries(newly.map((d) => [d.id, now])) } };
      await this.storage.put(KEY, record);
    }
    this.record = record;
    const dimensions = measured.map(({ id, unit, used, included, terminates }) => {
      const judged = terminates
        ? terminationOf({ used, included, overage_billing: overage, crossed_at: record.crossed[id], now_ms: now, ttl_hours: POLICY.overage_billing.termination_ttl_hours })
        : capOf({ used, included });
      return { id, unit, used, included, state: judged.state, terminate_at: judged.terminate_at ?? null };
    });
    return { period: { start: snapshot.period_start, end: snapshot.period_end }, overage_billing: overage, dimensions };
  }

  async #stateOf(id) {
    return (await this.meters()).dimensions.find((d) => d.id === id).state;
  }

  /** What the relay minter (ice.mjs) is told: the plan, this period's bytes in, the relay's state. */
  async iceTenant() {
    const { entitlements, snapshot } = this.current();
    return { limits: entitlements, bytesIn: snapshot.bytes_in, relayState: await this.#stateOf("relay-overage") };
  }

  /** False once document appends are terminated: documents are read-only until the period resets. */
  async documentsWritable() {
    return (await this.#stateOf("document-appends")) !== "terminated";
  }
}
