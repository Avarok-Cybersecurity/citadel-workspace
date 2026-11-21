/**
 * What the Worker's Cron trigger runs (wrangler.toml [triggers]): the usage monitor
 * (control/monitor.mjs).
 */
import { runMonitor } from "./monitor.mjs";

export async function runScheduled(io, cfg) {
  await runMonitor(io, cfg);
}
