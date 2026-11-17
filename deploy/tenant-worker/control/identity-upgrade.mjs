/**
 * The one-time upgrade of tenants provisioned before server identities (batch 1116 lane I4). Such
 * an object has no `[identity]` and no server key seed, so it refuses to start and publishes no
 * `/.well-known/citadel`. This step, and only this step, provisions it again: through the object's
 * own `provision()` (worker.mjs `upgradeIdentity`), which is the one path that makes a key, with
 * the identity the registry row describes (`<slug>.<CONTROL_HOST>`, no former domain, for every
 * row that predates custom domains). Reading never makes a key; until a tenant is reached here it
 * keeps refusing to start.
 *
 * Run by the Worker's Cron trigger (control/scheduled.mjs), so the deploy that ships it runs it
 * without anyone holding a key for it; deploy.sh waits for it to finish (DEPLOY.md).
 *
 * - Idempotent: an object with its domains and a key answers "unchanged"; one with a key keeps it
 *   (provision() of the same tenant reads the stored seed and never replaces it).
 * - Resumable: the registry records each row reached (identity_version); a later run visits only
 *   the rest, by slug, so a run cut short loses nothing.
 * - Bounded: pages of `pageSize` rows, at most `maxTenants` per run; the remainder is the next
 *   run's, and is logged as such.
 * - Reported: every tenant upgraded is logged; one that fails is logged with its reason, left
 *   unrecorded (so the next run tries it again), and returned in `failed` -- the run then fails
 *   (scheduled.mjs). Never skipped silently, and never stopping the others.
 */
import { identityOf } from "./tenant-domains.mjs";

/** One scheduled run: 50 rows a query, 500 tenants a run (each is two RPCs and two D1 writes). */
export const IDENTITY_UPGRADE_RUN = Object.freeze({ pageSize: 50, maxTenants: 500 });

const OUTCOMES = new Set(["upgraded", "unchanged"]);

/** `{upgraded, unchanged, failed: [{slug, reason}], more}` for the rows reached this run. */
export async function upgradeIdentities(io, cfg, { pageSize, maxTenants }) {
  if (!Number.isInteger(pageSize) || pageSize < 1 || !Number.isInteger(maxTenants) || maxTenants < 1) {
    throw new Error("the identity upgrade needs a whole pageSize and maxTenants, each at least 1");
  }
  const outcome = { upgraded: [], unchanged: [], failed: [], more: false };
  let after = "";
  let visited = 0;
  for (;;) {
    const page = await io.store.identityPending(after, Math.min(pageSize, maxTenants - visited));
    if (page.length === 0) break;
    for (const row of page) await upgradeOne(io, cfg, row, outcome);
    visited += page.length;
    after = page.at(-1).slug;
    if (visited >= maxTenants) {
      outcome.more = (await io.store.identityPending(after, 1)).length > 0;
      break;
    }
  }
  if (outcome.more) console.warn(`[identity-upgrade] ${visited} tenants visited, the most one run visits; the next run continues`);
  return outcome;
}

async function upgradeOne(io, cfg, row, outcome) {
  const identity = identityOf(cfg, row);
  try {
    const result = await io.tenant(row.slug).upgradeIdentity({ tenant_id: row.tenant_id, identity, display_name: row.display_name });
    if (!OUTCOMES.has(result)) throw new Error(`the object answered ${JSON.stringify(result)}`);
    if (!(await io.store.identityUpgraded(row.slug, row.tenant_id))) throw new Error("the registry row changed while it was upgraded");
    outcome[result].push(row.slug);
    if (result === "upgraded") console.log(`[identity-upgrade] ${row.slug}: provisioned as ${identity.canonical_domain} with its server key`);
    else console.log(`[identity-upgrade] ${row.slug}: already had its identity and key; unchanged`);
  } catch (e) {
    const reason = String(e?.message ?? e);
    outcome.failed.push({ slug: row.slug, reason });
    console.error(`[identity-upgrade] ${row.slug}: FAILED, not recorded, tried again next run: ${reason}`);
  }
}
