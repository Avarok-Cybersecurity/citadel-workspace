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
import { dispatch } from "./control/dispatch.mjs";
import { Provisioning } from "./control/provisioning.mjs";

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
export default {
  fetch: (request, env) => dispatch(request, env),
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
    this.connections = [];
    // What the control plane gave this tenant (its master password, its entitlements), read
    // before any request is delivered. One key-value entry, apart from the node's `citadel_*`
    // SQL tables.
    this.provisioning = new Provisioning(ctx.storage);
    ctx.blockConcurrencyWhile(() => this.provisioning.load());
  }

  /** RPC from the control plane: this tenant's master password and entitlements. */
  provision(data) {
    return this.provisioning.provision(data, this.server !== null);
  }

  /** RPC from the control plane: the tenant's plan changed. */
  setEntitlements(entitlements) {
    return this.provisioning.setEntitlements(entitlements);
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

  stats() {
    return {
      accepted: this.accepted,
      running: this.server !== null && this.exit === null,
      exit: this.exit,
      wasm_instance: this.wasm === null ? null : this.wasm.instance_id(),
      wasm_instances_in_isolate: instancesInIsolate,
      wasm_memory_bytes: this.wasm === null ? 0 : this.wasm.memory().buffer.byteLength,
      stored: this.storedRows(),
      connections: this.connections,
      ...this.provisioning.summary(),
    };
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return Response.json(this.stats());
    }
    if (this.exit !== null) {
      return new Response(`node exited: ${this.exit}`, { status: 503 });
    }
    if (!this.provisioning.ready()) {
      return new Response("this workspace has not been provisioned", { status: 503 });
    }
    if (this.server === null) {
      await this.provisioning.markStarted();
      if (this.server === null) this.start();
    }

    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    this.server.accept(server);
    this.accepted += 1;
    const n = this.accepted;
    const opened = Date.now();
    // Frames and bytes per connection, for the proof's report. CPU is measured outside the
    // isolate (proof.mjs samples workerd's process CPU at each phase boundary): inside it the
    // clocks cannot separate this object's work from the event loop's scheduling.
    const conn = { n, frames: 0, bytes_in: 0 };
    this.connections.push(conn);
    server.addEventListener("message", (e) => {
      conn.frames += 1;
      conn.bytes_in += e.data.byteLength ?? 0;
    });
    server.addEventListener("close", () => {
      console.log(`[tenant] connection ${n} closed after ${Date.now() - opened} ms; ${JSON.stringify(conn)}`);
    });
    return new Response(null, { status: 101, webSocket: client });
  }
}
