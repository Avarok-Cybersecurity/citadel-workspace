/**
 * The tenant object's side of secure links: the kernel's link limits, from the tenant's plan, and
 * the hourly purge of expired links (server-wasm `links.rs`).
 *
 * The limits are the entitlements the control plane stored (control/plans.mjs
 * `enforcedEntitlements`): `secure_links_per_member` and `secure_links_pool`. There is no default:
 * an object whose entitlements lack either refuses to make links and says why.
 */

/** How often expired links are purged: hourly (the plan). Expiry is enforced on read regardless. */
export const LINKS_PURGE_INTERVAL_MS = 60 * 60 * 1000;
/** When a pass left expired links behind (each pass is bounded), how soon the next one runs. */
export const LINKS_PURGE_SOON_MS = 60 * 1000;

/** One key-value entry: `{ due_ms, last: { at_ms, remaining } | { at_ms, error } | null }`. */
const KEY = "links_purge";

/** `{per_member, pool}` from `entitlements`; throws when either is missing or not a count. */
export function linkQuota(entitlements) {
  const quota = { per_member: entitlements.secure_links_per_member, pool: entitlements.secure_links_pool };
  for (const [field, value] of [["secure_links_per_member", quota.per_member], ["secure_links_pool", quota.pool]]) {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
      throw new Error(`the tenant's entitlements carry no usable ${field} (${JSON.stringify(value)})`);
    }
  }
  return quota;
}

/** The kernel's LinkQuotaHost: asked on every create and list, so a plan change applies at once. */
export function linkQuotaHost(entitlements) {
  return { quota: () => linkQuota(entitlements()) };
}

export class TenantLinks {
  /** `ready()` resolves to the object's running TenantServer once its storage is reachable. */
  constructor(storage, { ready }) {
    this.storage = storage;
    this.ready = ready;
    this.record = null;
  }

  async load() {
    this.record = (await this.storage.get(KEY)) ?? null;
  }

  /** When the next purge is due (an hour after the first look), or null for an object not provisioned. */
  async purgeDue(provisioned, nowMs) {
    if (!provisioned) return null;
    if (this.record === null) await this.#save({ due_ms: nowMs + LINKS_PURGE_INTERVAL_MS, last: null });
    return this.record.due_ms;
  }

  /** Purges one bounded pass if due at `nowMs`, sooner again when it left some behind. Never throws. */
  async purgeIfDue(nowMs, provisioned) {
    const due = await this.purgeDue(provisioned, nowMs);
    if (due === null || due > nowMs) return;
    try {
      const remaining = await (await this.ready()).purge_expired_links(nowMs);
      const next = remaining > 0 ? LINKS_PURGE_SOON_MS : LINKS_PURGE_INTERVAL_MS;
      await this.#save({ due_ms: nowMs + next, last: { at_ms: nowMs, remaining } });
    } catch (e) {
      console.error(`[tenant] secure-link purge failed: ${e?.stack ?? e}`);
      await this.#save({ due_ms: nowMs + LINKS_PURGE_INTERVAL_MS, last: { at_ms: nowMs, error: String(e?.message ?? e) } });
    }
  }

  /** The last purge's outcome and the next one's time, for the object's stats. */
  summary() {
    return this.record;
  }

  async #save(record) {
    this.record = record;
    await this.storage.put(KEY, record);
  }
}
