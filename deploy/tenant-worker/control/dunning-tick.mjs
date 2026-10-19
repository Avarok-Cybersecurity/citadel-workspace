/**
 * Dunning on the monitor's Cron (control/monitor.mjs): for one tenant, the reminders and the final
 * warning as they fall due, and the purge once the grace period is over (billing/dunning.mjs
 * `tick`). An email is recorded only once it is sent; one that fails throws, so the monitor's run
 * fails loudly naming the tenant, and the next run sends it.
 * A purge that died part-way is resumed from its audit (control/purge.mjs) even though its
 * dunning row has gone with its "usage" step.
 */
import { transition } from "../../../billing/dunning.mjs";
import { POLICY } from "./dunning-policy.mjs";
import { deliverDunningMail, stateOf } from "./dunning.mjs";
import { purgeTenant } from "./purge.mjs";

export async function dunningTick(io, cfg, row, now) {
  const held = await io.dunning.get(row.tenant_id);
  if (held === null) {
    if (row.status !== "suspended") return;
    const audit = await io.dunning.purgeOf(row.tenant_id);
    if (audit !== null && audit.finished_at === null) await purgeTenant(io, row, now);
    return;
  }
  if (row.status !== "suspended") throw new Error(`${row.slug} is ${row.status} with payment required: the registry disagrees with itself`);
  const state = stateOf(held);
  for (const action of transition(state, { type: "tick", at: now }, POLICY).actions) {
    if (action.type === "email") await deliverDunningMail(io, cfg, { email: action, state, row });
    else if (action.type === "purge") await purgeTenant(io, row, now);
    else throw new Error(`a dunning tick cannot ${action.type}`);
  }
}
