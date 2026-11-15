/**
 * The tenant object's side of secure links: the kernel's link limits (and its chat-document limit,
 * on the same host object), from the tenant's plan, and the hourly purge of expired links
 * (server-wasm `links.rs`), which also sweeps node chat files nobody needs (`chat_files.rs`).
 *
 * The limits are the entitlements the control plane stored (control/plans.mjs
 * `enforcedEntitlements`): `secure_links_per_member` and `secure_links_pool`. There is no default:
 * an object whose entitlements lack either refuses to make links and says why. Either is null
 * only for an unlimited grant (entitlements v2): no limit, passed to the kernel as such.
 */
import { limitOf } from "./entitlement-limits.mjs";

/** How often expired links are purged: hourly (the plan). Expiry is enforced on read regardless. */
export const LINKS_PURGE_INTERVAL_MS = 60 * 60 * 1000;
/** When a pass left expired links behind (each pass is bounded), how soon the next one runs. */
export const LINKS_PURGE_SOON_MS = 60 * 1000;

/**
 * One key-value entry: `{ due_ms, last: { at_ms, remaining | error, chat_files: { remaining } |
 * { error } } | null }`. The chat-file sweep shares this hourly entry rather than taking its own
 * slot on the object's one alarm: both are hourly, bounded and run on the node's storage.
 */
const KEY = "links_purge";

/** `{per_member, pool}` from `entitlements` (null: no limit); throws when either is missing or not a count. */
export function linkQuota(entitlements) {
  const quota = { per_member: limitOf(entitlements, "secure_links_per_member"), pool: limitOf(entitlements, "secure_links_pool") };
  for (const [field, value] of [["secure_links_per_member", quota.per_member], ["secure_links_pool", quota.pool]]) {
    if (value !== null && value > 0xffffffff) {
      throw new Error(`the tenant's entitlements carry no usable ${field} (${JSON.stringify(value)})`);
    }
  }
  return quota;
}

/**
 * `{limit}`: how many documents shared in chats the whole workspace may hold (`chat_documents`,
 * the tier's count plus 5000 per pack; null for an unlimited grant). Throws when the stored
 * entitlements carry no usable count, and the kernel then makes no new chat document.
 */
export function chatDocumentLimit(entitlements) {
  const limit = limitOf(entitlements, "chat_documents");
  if (limit !== null && limit > 0xffffffff) throw new Error(`the tenant's entitlements carry no usable chat_documents (${limit})`);
  return { limit };
}

/**
 * The kernel's LinkQuotaHost, which carries every plan limit the kernel asks for: asked on each
 * link create and list and each new chat document, so a plan change applies at once.
 */
export function linkQuotaHost(entitlements) {
  return { quota: () => linkQuota(entitlements()), chatDocuments: () => chatDocumentLimit(entitlements()) };
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

  /**
   * Runs the hourly passes if due at `nowMs`: expired links, then node chat files nobody needs
   * (server-wasm `chat_files.rs`), each bounded and each failing on its own. Sooner again when
   * either left some behind. Never throws.
   */
  async purgeIfDue(nowMs, provisioned) {
    const due = await this.purgeDue(provisioned, nowMs);
    if (due === null || due > nowMs) return;
    const links = await this.#pass("secure-link purge", (server) => server.purge_expired_links(nowMs));
    const chatFiles = await this.#pass("chat-file sweep", (server) => server.sweep_chat_attachments(nowMs));
    const again = links.remaining > 0 || chatFiles.remaining > 0;
    const next = again ? LINKS_PURGE_SOON_MS : LINKS_PURGE_INTERVAL_MS;
    await this.#save({ due_ms: nowMs + next, last: { at_ms: nowMs, ...links, chat_files: chatFiles } });
  }

  /** `{ remaining }` from one bounded pass, or `{ error }`. */
  async #pass(what, run) {
    try {
      return { remaining: await run(await this.ready()) };
    } catch (e) {
      console.error(`[tenant] ${what} failed: ${e?.stack ?? e}`);
      return { error: String(e?.message ?? e) };
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
