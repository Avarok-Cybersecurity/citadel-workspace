/**
 * The path policy a tenant's server runs, from its plan and billing/tiers.json `paths`: which
 * network paths peer connections may take, in which order, and what each may carry. Pure.
 *
 * The shape is the kernel's `path_policy` (the same one a native server's kernel.toml takes):
 * `{ rules: [{ kind, enabled, attempt_timeout_seconds, cost_weight, classes }], denied }`, rules in
 * precedence order. The kernel validates it with the protocol's PathPolicy, which has no default.
 */
import table from "../../../billing/tiers.json";

const KINDS = ["Direct", "PeerRelay", "Turn", "ServerRelay"];
const CLASSES = ["Control", "Msg", "File", "Media"];
const paths = table.paths;
if (!Array.isArray(paths?.order) || paths.order.length !== KINDS.length || !KINDS.every((k) => paths.order.includes(k))) {
  throw new Error(`tiers.json paths.order names each of ${KINDS.join(", ")} once`);
}
for (const field of ["attempt_timeout_seconds", "cost_weight"]) {
  for (const kind of KINDS) {
    if (!Number.isInteger(paths[field]?.[kind]) || paths[field][kind] < 0) throw new Error(`tiers.json paths.${field}.${kind} is a whole number`);
  }
}
const tierIds = new Set(table.tiers.map((t) => t.id));
if (!Array.isArray(paths.media_on_server_relay) || !paths.media_on_server_relay.every((t) => tierIds.has(t))) {
  throw new Error("tiers.json paths.media_on_server_relay lists known tiers");
}

/**
 * Whether the server relay may carry real-time media for these entitlements: only on a tier
 * tiers.json lists, and not while a trial clamps the plan to the free allowance.
 */
export function mediaOnServerRelay(entitlements) {
  return paths.media_on_server_relay.includes(entitlements.tier) && entitlements.trial_clamped !== true;
}

/** The policy for `entitlements` (control/plans.mjs `enforcedEntitlements`). */
export function pathPolicyOf(entitlements) {
  const media = mediaOnServerRelay(entitlements);
  return {
    rules: paths.order.map((kind) => ({
      kind,
      enabled: true,
      attempt_timeout_seconds: paths.attempt_timeout_seconds[kind],
      cost_weight: paths.cost_weight[kind],
      classes: kind === "ServerRelay" && !media ? CLASSES.filter((c) => c !== "Media") : [...CLASSES],
    })),
    denied: [],
  };
}
