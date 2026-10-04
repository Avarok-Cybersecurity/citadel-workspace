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
 * Each object instantiates the wasm module for itself (`instantiate`, see
 * make-instance-factory.mjs): objects can share an isolate, and a shared instance would share
 * every Rust global and the async task queue between tenants.
 */
import { DurableObject } from "cloudflare:workers";
import { instantiate } from "./server-wasm/pkg/instance.mjs";
import wasm from "./server-wasm/pkg/citadel_tenant_server_wasm_bg.wasm";
import { dispatch, ioFor, tenantFor } from "./control/dispatch.mjs";
import { config, isWebSocketUpgrade, json, turnConfig, upgradeRequired } from "./control/http.mjs";
import { IceMinter } from "./control/ice.mjs";
import { Provisioning } from "./control/provisioning.mjs";
import { Meter, periodAt } from "./control/meter.mjs";
import { UsageTable } from "./control/usage-table.mjs";
import { meterSocket } from "./control/sockets.mjs";
import { enforcedEntitlements, METERING } from "./control/plans.mjs";
import { runMonitor } from "./control/monitor.mjs";
import { storedRows } from "./control/stored-rows.mjs";
import { authVersions } from "./control/auth-versions.mjs";
import { ksfParams, TenantSignIn } from "./control/tenant-sign-in.mjs";

const FLUSH_MS = METERING.flush_seconds * 1000;
/** Periods `usage()` reports: the current one and the one before, whose final totals the monitor may not have seen. */
const REPORTED_PERIODS = 2;

// Wasm instances this isolate has created. Module state is per isolate, so objects that see the
// same count ran in one isolate.
let instancesInIsolate = 0;

function newInstance() {
  instancesInIsolate += 1;
  return instantiate(wasm);
}

function required(env, name) {
  const value = env[name];
  if (value === undefined || value === "") throw new Error(`${name} is not set`);
  return value;
}

// Which face a request is for -- the control plane or a tenant's object -- is decided in
// `control/dispatch.mjs`; a tenant's object is reached only while the registry says it is active.
// The Cron trigger (wrangler.toml [triggers]) runs the usage monitor (control/monitor.mjs).
export default {
  fetch: (request, env) => dispatch(request, env),
  scheduled: (_controller, env) => runMonitor(ioFor(env), config(env)),
};

export class WorkspaceServer extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.wasm = null;
    this.server = null;
    this.exit = null;
    this.accepted = 0;
    // What the control plane gave this tenant (its master password, its entitlements), read
    // before any request is delivered. One key-value entry, apart from the node's `citadel_*`
    // SQL tables.
    this.provisioning = new Provisioning(ctx.storage);
    // Metered usage (control/meter.mjs), resumed from this period's persisted totals.
    this.usageTable = new UsageTable(ctx.storage.sql);
    this.meter = null;
    // Sign-in (control/tenant-sign-in.mjs): the OPRF seed, the sign-in settings, the admission check.
    this.signIn = new TenantSignIn(ctx.storage, { random: crypto, turnstile: () => config(env).turnstile, io: { fetch: (u, i) => fetch(u, i) } });
    // Relay credentials for the kernel's GetIceServers (control/ice.mjs), gated on this tenant's
    // plan and this period's metered relay.
    this.ice = new IceMinter(turnConfig(env), { fetch: (url, init) => fetch(url, init), nowMs: Date.now }, () => {
      const now = Date.now();
      this.#roll(now);
      return { limits: enforcedEntitlements(this.provisioning.summary().entitlements), bytesIn: this.meter.snapshot(now).bytes_in };
    });
    ctx.blockConcurrencyWhile(async () => {
      await this.provisioning.load();
      await this.signIn.load();
      const now = Date.now();
      const period = periodAt(this.provisioning.summary().entitlements, now);
      this.meter = new Meter(period, this.usageTable.load(period.start), now);
    });
  }

  /** RPC from the control plane: this tenant's master password and entitlements. */
  async provision(data) {
    const before = this.provisioning.tenantId();
    await this.provisioning.provision(data, this.server !== null);
    await this.signIn.provisioned(before !== null && before !== data.tenant_id);
    this.#roll(Date.now());
  }

  /** RPC for discovery (dispatch.mjs): whether this workspace requires a check to sign in. */
  admissionRequired() {
    return this.signIn.required();
  }

  /** RPC from the control plane: the tenant's plan changed (a new billing period among it). */
  /** RPC from the control plane: the D1 name, for an object provisioned without one. */
  async adoptDisplayName(display_name) {
    return this.provisioning.adoptDisplayName(display_name);
  }

  async setEntitlements(entitlements) {
    await this.provisioning.setEntitlements(entitlements);
    this.#roll(Date.now());
  }

  /** RPC for the monitor: the entitlements this object enforces and its recent periods' totals, flushed now. */
  usage() {
    const now = Date.now();
    this.#roll(now);
    this.#flush(now);
    return { entitlements: this.provisioning.summary().entitlements, periods: this.usageTable.recent(REPORTED_PERIODS) };
  }

  /** RPC for the monitor: the stored accounts counted by auth-record version (read-only; no HTTP route). */
  authVersions() {
    return authVersions(this.ctx.storage.sql, (this.wasm ??= newInstance()));
  }

  /** The flush alarm: armed while any socket is open. Its own errors are logged, and it re-arms. */
  async alarm() {
    try {
      const now = Date.now();
      this.#roll(now);
      this.#flush(now);
    } catch (e) {
      console.error(`[tenant] usage flush failed: ${e?.stack ?? e}`);
    }
    if (this.meter.openCount > 0) await this.ctx.storage.setAlarm(Date.now() + FLUSH_MS);
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
    const env = this.env;
    const config = this.provisioning.kernelConfig();
    const t0 = Date.now();
    this.wasm ??= newInstance();
    const argon = new this.wasm.ArgonCost(
      Number(required(env, "ARGON_LANES")),
      Number(required(env, "ARGON_MEM_KIB")),
      Number(required(env, "ARGON_TIME_COST")),
    );
    const iceHost = { mint: (memberId) => this.ice.mint(memberId) };
    const ksf = ksfParams(env);
    const pq = new this.wasm.PqSignIn(this.signIn.takeSeed(), ksf.memKib, ksf.iterations, ksf.lanes);
    this.server = new this.wasm.TenantServer(config, this.storage(), argon, iceHost, pq, this.signIn.host(), required(env, "LOG_FILTER"), (outcome) => {
      this.exit = outcome;
      console.error(`[tenant] node exited: ${outcome}`);
    });
    console.log(`[tenant] node started in ${Date.now() - t0} ms`);
  }

  /**
   * The object's SQLite storage as the node's backend sees it (server-wasm `storage.rs`): run
   * `[[sql, params], ...]` as one transaction and return each statement's rows as arrays.
   */
  storage() {
    const storage = this.ctx.storage;
    return {
      run: (statements) =>
        storage.transactionSync(() => statements.map(([sql, params]) => [...storage.sql.exec(sql, ...params).raw()])),
      // What RE-VFS uploads may hold in total: the plan's storage, in tiers.json's own GB.
      quotaBytes: () => enforcedEntitlements(this.provisioning.summary().entitlements).storage_gb * METERING.gb_bytes,
    };
  }

  /** RPC, for the local proofs only: the Worker calls it when TENANT_DIAGNOSTICS is on (dispatch.mjs). */
  stats() {
    return {
      accepted: this.accepted,
      running: this.server !== null && this.exit === null,
      exit: this.exit,
      wasm_instance: this.wasm === null ? null : this.wasm.instance_id(),
      wasm_instances_in_isolate: instancesInIsolate,
      wasm_memory_bytes: this.wasm === null ? 0 : this.wasm.memory().buffer.byteLength,
      stored: storedRows(this.ctx.storage.sql),
      connections: this.meter.connections(),
      usage: this.meter.snapshot(Date.now()),
      ...this.provisioning.summary(),
    };
  }

  async fetch(request) {
    // Stats are an RPC the Worker gates (dispatch.mjs); a request is served only as a socket.
    if (!isWebSocketUpgrade(request)) {
      return upgradeRequired();
    }
    if (this.exit !== null) {
      return new Response(`node exited: ${this.exit}`, { status: 503 });
    }
    if (!this.provisioning.ready()) {
      return new Response("this workspace has not been provisioned", { status: 503 });
    }
    this.signIn.serving(tenantFor(new URL(request.url), config(this.env)));
    const limits = enforcedEntitlements(this.provisioning.summary().entitlements);
    this.#roll(Date.now());
    if (!this.meter.admits(limits.connections_max)) {
      return json({ error: "connection-limit", detail: `this workspace allows ${limits.connections_max} connections at once` }, 503, {
        "retry-after": "30",
      });
    }
    if (this.server === null) {
      await this.provisioning.markStarted();
      if (this.server === null) this.start();
    }

    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
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
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + FLUSH_MS);
    return new Response(null, { status: 101, webSocket: client });
  }
}
