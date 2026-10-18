/**
 * The tenant object's side of the Telemetry Service (plan section 3): the purge alarm, the
 * verified support read the control plane forwards (control/support.mjs), and the mirror of the
 * admin's support grant in D1 (control/support-store.mjs).
 *
 * Both kernel calls need the node's storage, which the kernel reaches only once the node has
 * started (server-wasm `telemetry.rs`), so each starts the node if it is not running and waits,
 * bounded, until it is ready.
 */

/** How often expired telemetry is purged: daily (the plan). Uploads also enforce it on write. */
export const TELEMETRY_PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** After a failed purge, how long until the next attempt. */
export const TELEMETRY_PURGE_RETRY_MS = 60 * 60 * 1000;
/** How long a kernel call waits for a node it started, and how often it looks. */
export const NODE_READY_TIMEOUT_MS = 15_000;
export const NODE_READY_POLL_MS = 25;

/** One key-value entry: `{ due_ms, last: { at_ms, removed } | { at_ms, error } | null }`. */
const KEY = "telemetry_purge";

/**
 * The object has one alarm. Its time: the next usage flush (`flushMs` from now while a socket is
 * open, else null) or the earliest due purge -- telemetry's, then secure links' (each null while
 * the tenant is not provisioned) -- whichever is earliest.
 */
export function nextAlarm(nowMs, flushMs, ...purgeDueMs) {
  const times = [flushMs === null ? null : nowMs + flushMs, ...purgeDueMs].filter((t) => t !== null);
  return times.length === 0 ? null : Math.min(...times);
}

export class TenantTelemetry {
  /**
   * `server()` resolves to the object's running TenantServer, starting it if need be;
   * `tenantId()` is the provisioned tenant; `grants` is the D1 mirror; `nowMs` and `wait(ms)` the
   * clock and a timer.
   */
  constructor(storage, { server, tenantId, grants, nowMs, wait }) {
    this.storage = storage;
    this.io = { server, tenantId, grants, nowMs, wait };
    this.record = null;
  }

  async load() {
    this.record = (await this.storage.get(KEY)) ?? null;
  }

  /** When the next purge is due (fixed, once, a day after the first look), or null for an object that is not provisioned. */
  async purgeDue(provisioned, nowMs) {
    if (!provisioned) return null;
    if (this.record === null) await this.#save({ due_ms: nowMs + TELEMETRY_PURGE_INTERVAL_MS, last: null });
    return this.record.due_ms;
  }

  /** Purges if one is due at `nowMs`; a failure is logged and retried later, never thrown. */
  async purgeIfDue(nowMs, provisioned) {
    const due = await this.purgeDue(provisioned, nowMs);
    if (due === null || due > nowMs) return;
    try {
      const removed = await (await this.#ready()).purge_expired_telemetry(nowMs);
      console.log(`[tenant] telemetry purge removed ${removed} segment(s)`);
      await this.#save({ due_ms: nowMs + TELEMETRY_PURGE_INTERVAL_MS, last: { at_ms: nowMs, removed } });
    } catch (e) {
      console.error(`[tenant] telemetry purge failed: ${e?.stack ?? e}`);
      await this.#save({ due_ms: nowMs + TELEMETRY_PURGE_RETRY_MS, last: { at_ms: nowMs, error: String(e?.message ?? e) } });
    }
  }

  /** The last purge's outcome and the next one's time, for the object's stats. */
  summary() {
    return this.record;
  }

  /** A verified support fetch's query (TelemetryQuery JSON): `{ served, body }`. */
  async supportRead(query, nowMs) {
    return (await this.#ready()).support_list_telemetry(query, nowMs);
  }

  /** The kernel's grant observer (server-wasm `support.rs`): mirrors each change into D1. */
  grantHost() {
    return {
      changed: async (enabled, untilMs) => {
        const tenantId = this.io.tenantId();
        if (tenantId === null) throw new Error("a grant changed on an object with no tenant");
        await this.io.grants.recordGrant(tenantId, enabled ? untilMs : null, this.io.nowMs());
      },
    };
  }

  /** The running node once its storage is reachable; the links purge waits on it too. */
  ready() {
    return this.#ready();
  }

  async #ready() {
    const server = await this.io.server();
    const deadline = this.io.nowMs() + NODE_READY_TIMEOUT_MS;
    while (!server.telemetry_ready()) {
      if (this.io.nowMs() >= deadline) throw new Error(`the node was not ready after ${NODE_READY_TIMEOUT_MS} ms`);
      await this.io.wait(NODE_READY_POLL_MS);
    }
    return server;
  }

  async #save(record) {
    this.record = record;
    await this.storage.put(KEY, record);
  }
}
