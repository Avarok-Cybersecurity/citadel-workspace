/**
 * The purge at the end of dunning (billing/dunning.mjs): everything the workspace holds is deleted
 * and its slug released. Idempotent and resumable: each step is recorded in `tenant_purges.steps`
 * once done (the D1 steps in the same batch as their deletes), so a run that dies resumes at the
 * first step not recorded, and a finished purge does nothing.
 *
 *   object    the tenant's Durable Object erases its storage and alarm (worker.mjs `purge`); it
 *             refuses if it was provisioned for another tenant
 *   usage     tenant_usage, tenant_alerts and tenant_dunning rows
 *   registry  the tenants row: the slug is free again. The tenant_purges row stays, the audit.
 */

export const PURGE_STEPS = Object.freeze(["object", "usage", "registry"]);

const RUN = {
  object: async (io, row, steps) => {
    await io.tenant(row.slug).purge(row.tenant_id);
    await io.dunning.recordSteps(row.tenant_id, steps);
  },
  usage: (io, row, steps) => io.dunning.purgeUsage(row.tenant_id, steps),
  registry: (io, row, steps, now) => io.dunning.purgeRegistry(row, steps, now),
};

/** Purges `row` (a tenants row), from wherever an earlier run of it stopped. */
export async function purgeTenant(io, row, now) {
  const audit = await io.dunning.beginPurge(row, now);
  if (audit.slug !== row.slug) throw new Error(`the purge of ${row.tenant_id} was begun for ${audit.slug}, not ${row.slug}`);
  const steps = JSON.parse(audit.steps);
  for (const step of PURGE_STEPS) {
    if (steps.includes(step)) continue;
    const done = [...steps, step];
    await RUN[step](io, row, done, now);
    steps.push(step);
    console.log(`[purge] ${row.slug} ${step}`);
  }
}
