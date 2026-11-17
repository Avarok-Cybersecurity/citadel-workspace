/**
 * The manifest rules of the P2P and topic capabilities and their limits, rule for rule with
 * apps_manifest_check_peer.rs: `ihttp.p2p.serve` lists routes that `ihttp.serve` also lists,
 * `ihttp.p2p.call` lists no targets (an app calls its own copies, v1), `group.topic.*` list 1 to
 * MAX_TOPICS distinct topic names, and `limits.p2p` / `limits.topics` are present exactly when a
 * capability of theirs is, each within its ceilings. Each answers the reason it refused, or null.
 */
import type { AppLimits, Capability, CapabilityRequest } from 'citadel-workspace-client-ts';
import { MAX_TOPICS, TOPIC_MAX_MSG_BYTES_CEILING, TOPIC_MAX_MSGS_PER_S_CEILING } from '../sdk/generated/AbiConstants';
import { STANDARD_IHTTP_LIMITS } from '../host/limits';
import { isTopicName } from './topic-names';

const MAX_FANOUT_CONCURRENCY: number = 32;
const MAX_FANOUT_BYTES: number = 64 * 1024 * 1024;
const MAX_FANOUT_MS: number = 300_000;
/** A P2P response is at most what any internal-HTTP response may be. */
const MAX_P2P_RESPONSE_BYTES: number = STANDARD_IHTTP_LIMITS.maxResponseBodyBytes;

export const takesRoutes = (cap: Capability): boolean => cap === 'ihttp.serve' || cap === 'ihttp.p2p.serve';
export const takesTargets = (cap: Capability): boolean => cap === 'ihttp.call' || cap === 'ihttp.p2p.call';
export const takesTopics = (cap: Capability): boolean => cap === 'group.topic.subscribe' || cap === 'group.topic.publish';
const isP2p = (cap: Capability): boolean => cap === 'ihttp.p2p.serve' || cap === 'ihttp.p2p.call';

const listed = (requests: readonly CapabilityRequest[], cap: Capability): CapabilityRequest | undefined => requests.find((r: CapabilityRequest) => r.cap === cap);

export function peerCapabilitiesProblem(requests: readonly CapabilityRequest[]): string | null {
  const p2pServe: CapabilityRequest | undefined = listed(requests, 'ihttp.p2p.serve');
  if (p2pServe !== undefined) {
    const relay: CapabilityRequest | undefined = listed(requests, 'ihttp.serve');
    if (relay === undefined) return 'ihttp.p2p.serve without ihttp.serve';
    if (!(p2pServe.routes ?? []).every((r: string) => (relay.routes ?? []).includes(r))) return 'ihttp.p2p.serve: a route ihttp.serve does not list';
  }
  if ((listed(requests, 'ihttp.p2p.call')?.targets ?? []).length > 0) return 'ihttp.p2p.call: targets must be empty (an app calls its own copies)';
  for (const r of requests.filter((x: CapabilityRequest) => takesTopics(x.cap))) {
    const topics: string[] = r.topics ?? [];
    const ok: boolean = topics.length >= 1 && topics.length <= MAX_TOPICS && topics.every(isTopicName) && new Set(topics).size === topics.length;
    if (!ok) return `${r.cap}: topics`;
  }
  return null;
}

export function peerLimitsProblem(limits: AppLimits, requests: readonly CapabilityRequest[]): string | null {
  const asks = (test: (cap: Capability) => boolean): boolean => requests.some((r: CapabilityRequest) => test(r.cap));
  if ((limits.p2p !== undefined && limits.p2p !== null) !== asks(isP2p)) return 'p2p';
  if ((limits.topics !== undefined && limits.topics !== null) !== asks(takesTopics)) return 'topics';
  const within = (v: number, max: number): boolean => Number.isInteger(v) && v >= 1 && v <= max;
  const checks: Array<[string, boolean]> = [];
  if (limits.p2p) {
    checks.push(['p2p.max_fanout_concurrency', within(limits.p2p.max_fanout_concurrency, MAX_FANOUT_CONCURRENCY)]);
    checks.push(['p2p.max_fanout_bytes', within(limits.p2p.max_fanout_bytes, MAX_FANOUT_BYTES)]);
    checks.push(['p2p.max_fanout_ms', within(limits.p2p.max_fanout_ms, MAX_FANOUT_MS)]);
    checks.push(['p2p.max_response_bytes', within(limits.p2p.max_response_bytes, MAX_P2P_RESPONSE_BYTES)]);
  }
  if (limits.topics) {
    checks.push(['topics.max_msg_bytes', within(limits.topics.max_msg_bytes, TOPIC_MAX_MSG_BYTES_CEILING)]);
    checks.push(['topics.max_msgs_per_s', within(limits.topics.max_msgs_per_s, TOPIC_MAX_MSGS_PER_S_CEILING)]);
  }
  return checks.find(([, ok]) => !ok)?.[0] ?? null;
}
