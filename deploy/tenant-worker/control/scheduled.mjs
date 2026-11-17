/**
 * What the Worker's Cron trigger runs (wrangler.toml [triggers]): the identity upgrade
 * (control/identity-upgrade.mjs), then the usage monitor (control/monitor.mjs). Each runs whatever
 * the other does; the run fails, naming every failure, if either did.
 */
import { IDENTITY_UPGRADE_RUN, upgradeIdentities } from "./identity-upgrade.mjs";
import { runMonitor } from "./monitor.mjs";

export async function runScheduled(io, cfg) {
  const failures = [];
  try {
    const { failed } = await upgradeIdentities(io, cfg, IDENTITY_UPGRADE_RUN);
    if (failed.length) failures.push(`identity upgrade: ${failed.length} tenant(s) failed: ${failed.map((f) => `${f.slug}: ${f.reason}`).join("; ")}`);
  } catch (e) {
    failures.push(`identity upgrade: ${e?.message ?? e}`);
  }
  try {
    await runMonitor(io, cfg);
  } catch (e) {
    failures.push(String(e?.message ?? e));
  }
  if (failures.length) throw new Error(failures.join(" | "));
}
