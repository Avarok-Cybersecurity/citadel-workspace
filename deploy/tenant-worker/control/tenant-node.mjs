/**
 * The Citadel node a tenant's object runs (server-wasm `TenantServer`), and the storage it is
 * given: the wasm side of worker.mjs's `start()`, kept apart from the object's socket plumbing.
 */
import { instantiate } from "../server-wasm/pkg/instance.mjs";
import wasm from "../server-wasm/pkg/citadel_tenant_server_wasm_bg.wasm";
import { required } from "./http.mjs";
import { enforcedEntitlements, METERING } from "./plans.mjs";
import { limitOf } from "./entitlement-limits.mjs";
import { ksfParams } from "./tenant-sign-in.mjs";
import { linkQuotaHost } from "./tenant-links.mjs";
import { pathPolicyOf } from "./path-policy.mjs";
import { TURN_BYTES_PER_MEMBER_HOUR, TurnIntake } from "./turn-cap.mjs";
import { AppsUsageIntake } from "./apps-usage.mjs";

// Wasm instances this isolate has created. Module state is per isolate, so objects that see the
// same count ran in one isolate.
let instancesInIsolate = 0;

/** A wasm instance of the server's own: each object makes one (worker.mjs). */
export function newInstance() {
  instancesInIsolate += 1;
  return instantiate(wasm);
}

/** For the object's stats: which instance `instance` is (null before it has one), and its memory. */
export function wasmStats(instance) {
  return {
    wasm_instance: instance === null ? null : instance.instance_id(),
    wasm_instances_in_isolate: instancesInIsolate,
    wasm_memory_bytes: instance === null ? 0 : instance.memory().buffer.byteLength,
  };
}

/**
 * The object's SQLite storage as the node's backend sees it (server-wasm `storage.rs`): run
 * `[[sql, params], ...]` as one transaction and return each statement's rows as arrays.
 * `entitlements()` is the tenant's current plan.
 */
export function nodeStorage(storage, entitlements) {
  return {
    run: (statements) =>
      storage.transactionSync(() => statements.map(([sql, params]) => [...storage.sql.exec(sql, ...params).raw()])),
    // What RE-VFS uploads may hold in total: the plan's storage, in tiers.json's own GB; null for
    // no limit (an unlimited grant).
    quotaBytes: () => {
      const gb = limitOf(enforcedEntitlements(entitlements()), "storage_gb");
      return gb === null ? null : gb * METERING.gb_bytes;
    },
  };
}

/**
 * Starts the node in `wasm` (the object's own instance) with the object's capabilities: `ice`
 * mints relay credentials, `signIn` is the object's TenantSignIn, `grants` the support-grant
 * mirror, `plan()` the tenant's enforced entitlements, `meter()` the object's current meter:
 * members' reported TURN bytes go to it through their hourly ceiling (control/turn-cap.mjs,
 * server-wasm turn.rs), and apps' usage through its intake (control/apps-usage.mjs, usage.rs);
 * `onExit(outcome)` is told how the node ended. The plan gives the secure-link limits (control/tenant-links.mjs), read on each use, and
 * the path policy (control/path-policy.mjs), read once here: a plan change reaches the path
 * policy at the node's next start, not on a running node (v1).
 */
export function startNode(wasm, env, { config, storage, ice, signIn, grants, plan, meter, onExit }) {
  const argon = new wasm.ArgonCost(
    Number(required(env, "ARGON_LANES")),
    Number(required(env, "ARGON_MEM_KIB")),
    Number(required(env, "ARGON_TIME_COST")),
  );
  const ksf = ksfParams(env);
  const pq = new wasm.PqSignIn(signIn.takeSeed(), ksf.memKib, ksf.iterations, ksf.lanes);
  const links = linkQuotaHost(plan);
  const pathPolicy = JSON.stringify(pathPolicyOf(plan()));
  const turnUsage = new TurnIntake(meter, Date.now, TURN_BYTES_PER_MEMBER_HOUR);
  const appsUsage = new AppsUsageIntake(meter);
  return new wasm.TenantServer(config, storage, argon, ice, pq, signIn.host(), grants, links, turnUsage, appsUsage, required(env, "STUN_SERVERS"), pathPolicy, required(env, "LOG_FILTER"), onExit);
}
