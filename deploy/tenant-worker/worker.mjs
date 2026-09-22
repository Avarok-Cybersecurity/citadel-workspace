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
import { dispatch, ioFor } from "./control/dispatch.mjs";
import { config, isWebSocketUpgrade, json, upgradeRequired } from "./control/http.mjs";
import { Provisioning } from "./control/provisioning.mjs";
import { Meter, periodAt } from "./control/meter.mjs";
import { UsageTable } from "./control/usage-table.mjs";
import { meterSocket } from "./control/sockets.mjs";
import { enforcedEntitlements, METERING } from "./control/plans.mjs";
import { runMonitor } from "./control/monitor.mjs";

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
    ctx.blockConcurrencyWhile(async () => {
      await this.provisioning.load();
      const now = Date.now();
      const period = periodAt(this.provisioning.summary().entitlements, now);
      this.meter = new Meter(period, this.usageTable.load(period.start), now);
    });
  }

  /** RPC from the control plane: this tenant's master password and entitlements. */
  async provision(data) {
    await this.provisioning.provision(data, this.server !== null);
    this.#roll(Date.now());
  }

  /** RPC from the control plane: the tenant's plan changed (a new billing period among it). */
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
    // `bind_addr` is recorded as the node's address and never bound: the object owns no socket.
    const config = [
      `bind_addr = "127.0.0.1:0"`,
      `workspace_master_password = ${JSON.stringify(this.provisioning.masterPassword())}`,
    ].join("\n");
    const t0 = Date.now();
    this.wasm = newInstance();
    const argon = new this.wasm.ArgonCost(
      Number(required(env, "ARGON_LANES")),
      Number(required(env, "ARGON_MEM_KIB")),
      Number(required(env, "ARGON_TIME_COST")),
    );
    this.server = new this.wasm.TenantServer(config, this.storage(), argon, required(env, "LOG_FILTER"), (outcome) => {
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
    };
  }

  /** Row counts and the largest stored value per table, for the proofs and the limits report. */
  storedRows() {
    const sql = this.ctx.storage.sql;
    const tables = [...sql.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'citadel_%'")].map((r) => r.name);
    return Object.fromEntries(
      tables.map((t) => {
        const hasBin = [...sql.exec(`SELECT name FROM pragma_table_info('${t}') WHERE name = 'bin'`)].length > 0;
        const size = hasBin ? "COALESCE(MAX(LENGTH(bin)), 0)" : "0";
        return [t, sql.exec(`SELECT COUNT(*) AS rows, ${size} AS max_bin_bytes FROM ${t}`).one()];
      }),
    );
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
      stored: this.storedRows(),
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
    meterSocket(server, {
      meter: this.meter,
      id: n,
      maxFrameBytes: limits.max_frame_bytes,
      now: Date.now,
      onRelease: (record) => {
        console.log(`[tenant] connection ${n} closed after ${record.open_ms} ms; ${JSON.stringify(record)}`);
        if (this.meter.openCount === 0) this.#flush(Date.now());
      },
    });
    this.server.accept(server);
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + FLUSH_MS);
    return new Response(null, { status: 101, webSocket: client });
  }
}
