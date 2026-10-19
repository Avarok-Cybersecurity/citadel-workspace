/**
 * The tenant worker: one workspace server per tenant, each a Durable Object.
 *
 * This file does sockets and storage plumbing and nothing else. The Worker routes a WebSocket
 * upgrade to the tenant's object; the object accepts the server half of a `WebSocketPair` and
 * hands it to the Citadel node running inside it (`server-wasm`, the same workspace kernel the
 * native server runs). The node's sessions and ratchets are in memory, so an evicted object drops
 * its clients and they reconnect; its accounts and workspace data are in the object's SQLite
 * storage, so they are there when they do.
 *
 * Each object instantiates the wasm module for itself (control/tenant-node.mjs): objects can share
 * an isolate, and a shared instance would share every Rust global and task queue between tenants.
 */
import { DurableObject } from "cloudflare:workers";
import { dispatch, ioFor, tenantFor } from "./control/dispatch.mjs";
import { config, connectionLimit, isWebSocketUpgrade, upgradeRequired } from "./control/http.mjs";
import { Provisioning } from "./control/provisioning.mjs";
import { Meter, periodAt } from "./control/meter.mjs";
import { UsageTable } from "./control/usage-table.mjs";
import { meterSocket } from "./control/sockets.mjs";
import { enforcedEntitlements, METERING } from "./control/plans.mjs";
import { runMonitor } from "./control/monitor.mjs";
import { objectStats } from "./control/object-stats.mjs";
import { authVersions } from "./control/auth-versions.mjs";
import { TenantSignIn } from "./control/tenant-sign-in.mjs";
import { newInstance, nodeStorage, startNode } from "./control/tenant-node.mjs";
import { nextAlarm } from "./control/tenant-telemetry.mjs";
import { linkQuotaHost } from "./control/tenant-links.mjs";
import { withAppendsIncluded } from "./control/tenant-documents.mjs";
import { objectParts } from "./control/object-parts.mjs";
import { eraseObject, PAYMENT_REQUIRED } from "./control/suspension.mjs";

const FLUSH_MS = METERING.flush_seconds * 1000;
/** Periods `usage()` reports: the current one and the one before, whose final totals the monitor may not have seen. */
const REPORTED_PERIODS = 2;

// Which face a request is for -- the control plane or a tenant's object -- is decided in
// `control/dispatch.mjs`; a tenant's object is reached only while the registry says it is active.
// The Cron trigger (wrangler.toml [triggers]) runs the usage monitor (control/monitor.mjs).
export default {
  fetch: (request, env) => dispatch(request, env),
  scheduled: (_controller, env) => runMonitor(ioFor(env), config(env)),
};

export class WorkspaceServer extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env); // sets this.ctx and this.env
    this.wasm = null;
    this.server = null;
    this.exit = null;
    this.accepted = 0;
    // What the control plane gave this tenant (its master password, its entitlements), read before
    // any request is delivered. One key-value entry, apart from the node's `citadel_*` SQL tables.
    this.provisioning = new Provisioning(ctx.storage);
    // Metered usage (control/meter.mjs), resumed from this period's persisted totals.
    this.usageTable = new UsageTable(ctx.storage.sql);
    this.meter = null;
    // Sign-in (control/tenant-sign-in.mjs): the OPRF seed, the sign-in settings, the admission check.
    this.signIn = new TenantSignIn(ctx.storage, { random: crypto, turnstile: () => config(env).turnstile, siteKey: () => config(env).turnstileSiteKey, io: { fetch: (u, i) => fetch(u, i) } });
    // Billing state, relay, the purges on the alarm, appends, open sockets (control/object-parts.mjs).
    Object.assign(this, objectParts(this, ctx, env, { roll: (now) => this.#roll(now), running: () => this.#running() }));
    ctx.blockConcurrencyWhile(async () => {
      await this.provisioning.load();
      await this.signIn.load();
      await this.billing.load();
      for (const purge of this.purges) await purge.load();
      const now = Date.now();
      const period = periodAt(this.provisioning.summary().entitlements, now);
      this.meter = new Meter(period, this.usageTable.load(period.start), now);
      await this.#arm(false);
    });
  }

  /** RPC from the control plane: this tenant's master password and entitlements. */
  async provision(data) {
    const before = this.provisioning.tenantId();
    await this.provisioning.provision(data, this.server !== null);
    await this.signIn.provisioned(before !== null && before !== data.tenant_id);
    this.#roll(Date.now());
    await this.#arm(false);
  }

  /** RPC for discovery (dispatch.mjs): whether this workspace requires a check to sign in. */
  admissionRequired() {
    return this.signIn.required();
  }

  /** RPC from the control plane (control/support.mjs), once it has verified a signed support request. */
  supportListTelemetry(query, nowMs) {
    return this.telemetry.supportRead(query, nowMs);
  }

  /** RPC from the control plane: the D1 name, for an object provisioned without one. */
  async adoptDisplayName(display_name) {
    return this.provisioning.adoptDisplayName(display_name);
  }

  /** RPC from the control plane: the plan changed (a new billing period among it). */
  async setEntitlements(entitlements) {
    await this.provisioning.setEntitlements(entitlements);
    if (!this.provisioning.ready()) this.sockets.closeAll(PAYMENT_REQUIRED);
    this.#roll(Date.now());
    await this.#arm(false);
  }

  /** RPC from the purge (control/purge.mjs): erases this object for `tenantId`, then resets it. */
  async purge(tenantId) {
    await eraseObject(this.ctx, this.provisioning, this.sockets, tenantId);
  }

  /** RPC for the monitor: the entitlements enforced, the recent periods' totals (flushed now), the dimensions. */
  async usage() {
    const now = Date.now();
    this.#roll(now);
    this.#flush(now);
    const { entitlements } = this.provisioning.summary();
    const included = enforcedEntitlements(entitlements).document_appends_included;
    return { entitlements, periods: withAppendsIncluded(this.usageTable.recent(REPORTED_PERIODS), included), ...(await this.meters()) };
  }

  /** The host the Citadel Docs kernel counts its stored appends through (control/tenant-documents.mjs). */
  documentsHost() {
    return this.documents.host();
  }

  /** RPC (tests, the proof): `n` appends stored, as the kernel reports them through `documentsHost()`. */
  recordAppends(n) {
    this.documents.appended(n);
  }

  /** RPCs (control/tenant-billing.mjs): this period's dimensions; whether documents take appends. */
  meters() { return this.billing.meters(); }
  documentsWritable() { return this.billing.documentsWritable(); }

  /** RPC for the monitor: the stored accounts counted by auth-record version (read-only; no HTTP route). */
  authVersions() {
    return authVersions(this.ctx.storage.sql, (this.wasm ??= newInstance()));
  }

  /** The usage flush (while a socket is open) and the purges. Errors are logged; it re-arms. */
  async alarm() {
    const now = Date.now();
    try {
      this.#roll(now);
      this.#flush(now);
    } catch (e) {
      console.error(`[tenant] usage flush failed: ${e?.stack ?? e}`);
    }
    for (const purge of this.purges) await purge.purgeIfDue(now, this.provisioning.ready());
    await this.#arm(true);
  }

  /** The one alarm, at the earliest of the next flush and each next purge; `replace` or when that is sooner. */
  async #arm(replace) {
    const now = Date.now();
    const due = await Promise.all(this.purges.map((purge) => purge.purgeDue(this.provisioning.ready(), now)));
    const at = nextAlarm(now, this.meter.openCount > 0 ? FLUSH_MS : null, ...due);
    const current = replace ? null : await this.ctx.storage.getAlarm();
    if (at !== null && (current === null || current > at)) await this.ctx.storage.setAlarm(at);
  }

  /** The running node, started now if it is not. */
  async #running() {
    if (this.exit !== null) throw new Error(`node exited: ${this.exit}`);
    if (!this.provisioning.ready()) throw new Error("this workspace has not been provisioned");
    if (this.server === null) {
      await this.provisioning.markStarted();
      if (this.server === null) this.start();
    }
    return this.server;
  }

  /** Closes the metered period when the billing period has moved on, persisting its final totals. */
  #roll(now) {
    const closed = this.meter.adopt(periodAt(this.provisioning.summary().entitlements, now), now);
    if (closed) this.usageTable.save(closed, now);
  }

  #flush(now) {
    this.usageTable.save(this.meter.snapshot(now), now);
  }

  start() {
    const t0 = Date.now();
    this.wasm ??= newInstance();
    this.server = startNode(this.wasm, this.env, {
      config: this.provisioning.kernelConfig(),
      storage: this.storage(),
      ice: { mint: (memberId) => this.ice.mint(memberId) },
      signIn: this.signIn,
      grants: this.telemetry.grantHost(),
      links: linkQuotaHost(() => enforcedEntitlements(this.provisioning.summary().entitlements)),
      onExit: (outcome) => {
        this.exit = outcome;
        console.error(`[tenant] node exited: ${outcome}`);
      },
    });
    console.log(`[tenant] node started in ${Date.now() - t0} ms`);
  }

  /** The object's SQLite storage as the node's backend sees it (control/tenant-node.mjs). */
  storage() {
    return nodeStorage(this.ctx.storage, () => this.provisioning.summary().entitlements);
  }

  /** RPC, for the local proofs only: the Worker calls it when TENANT_DIAGNOSTICS is on (dispatch.mjs). */
  stats() {
    return objectStats(this);
  }

  async fetch(request) {
    // Stats are an RPC the Worker gates (dispatch.mjs); a request is served only as a socket.
    if (!isWebSocketUpgrade(request)) return upgradeRequired();
    if (this.exit !== null) return new Response(`node exited: ${this.exit}`, { status: 503 });
    if (!this.provisioning.ready()) return new Response("this workspace has not been provisioned", { status: 503 });
    this.signIn.serving(tenantFor(new URL(request.url), config(this.env)));
    const limits = enforcedEntitlements(this.provisioning.summary().entitlements);
    this.#roll(Date.now());
    if (!this.meter.admits(limits.connections_max)) return connectionLimit(limits.connections_max);
    await this.#running();

    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    this.sockets.add(server);
    this.accepted += 1;
    const n = this.accepted;
    // Frames and bytes per connection and per period (control/meter.mjs). CPU is measured outside
    // the isolate (proof.mjs samples workerd's process CPU at each phase boundary).
    this.meter.connect(n, Date.now());
    let peer = null;
    meterSocket(server, {
      meter: this.meter,
      id: n,
      maxFrameBytes: limits.max_frame_bytes,
      now: Date.now,
      onRelease: (record) => {
        console.log(`[tenant] connection ${n} closed after ${record.open_ms} ms; ${JSON.stringify(record)}`);
        if (peer !== null) this.signIn.released(peer);
        if (this.meter.openCount === 0) this.#flush(Date.now());
      },
    });
    peer = this.server.accept(server);
    // The client's address, for the admission check's siteverify (control/admission.mjs).
    this.signIn.connected(peer, request.headers.get("cf-connecting-ip"));
    await this.#arm(false);
    return new Response(null, { status: 101, webSocket: client });
  }
}
