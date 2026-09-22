/**
 * The tenant worker: one workspace server per tenant, each a Durable Object.
 *
 * This file does sockets and nothing else. The Worker routes a WebSocket upgrade to the tenant's
 * object; the object accepts the server half of a `WebSocketPair` and hands it to the Citadel
 * node running inside it (`server-wasm`, the same workspace kernel the native server runs). The
 * node lives as long as the object does: its sessions and ratchets are in memory, so an evicted
 * object drops its clients and they reconnect.
 */
import { DurableObject } from "cloudflare:workers";
import { initSync, TenantServer, ArgonCost } from "./server-wasm/pkg/citadel_tenant_server_wasm.js";
import wasm from "./server-wasm/pkg/citadel_tenant_server_wasm_bg.wasm";
import { dispatch } from "./control/dispatch.mjs";
import { Provisioning } from "./control/provisioning.mjs";

// `--target web`, instantiated by hand from the module the runtime hands over (the rMazing
// notary-worker pattern): a `.wasm` import arrives as an uninstantiated `WebAssembly.Module`.
const exports = initSync({ module: wasm });

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
    this.server = null;
    this.exit = null;
    this.accepted = 0;
    this.connections = [];
    // What the control plane gave this tenant (its master password, its entitlements), read
    // before any request is delivered.
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
    const argon = new ArgonCost(
      Number(required(env, "ARGON_LANES")),
      Number(required(env, "ARGON_MEM_KIB")),
      Number(required(env, "ARGON_TIME_COST")),
    );
    const t0 = Date.now();
    this.server = new TenantServer(config, argon, required(env, "LOG_FILTER"), (outcome) => {
      this.exit = outcome;
      console.error(`[tenant] node exited: ${outcome}`);
    });
    console.log(`[tenant] node started in ${Date.now() - t0} ms`);
  }

  stats() {
    return {
      accepted: this.accepted,
      running: this.server !== null && this.exit === null,
      exit: this.exit,
      wasm_memory_bytes: exports.memory.buffer.byteLength,
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
