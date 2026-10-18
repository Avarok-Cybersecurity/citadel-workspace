/**
 * The tenant object's diagnostics (worker.mjs `stats()`, an RPC the Worker gates in dispatch.mjs):
 * what the object holds and has done, read from its parts. Read-only.
 */
import { storedRows } from "./stored-rows.mjs";
import { wasmStats } from "./tenant-node.mjs";

/** `object` is the WorkspaceServer Durable Object. */
export function objectStats(object) {
  return {
    accepted: object.accepted,
    running: object.server !== null && object.exit === null,
    exit: object.exit,
    ...wasmStats(object.wasm),
    stored: storedRows(object.ctx.storage.sql),
    connections: object.meter.connections(),
    telemetry_purge: object.telemetry.summary(),
    links_purge: object.links.summary(),
    usage: object.meter.snapshot(Date.now()),
    ...object.provisioning.summary(),
  };
}
