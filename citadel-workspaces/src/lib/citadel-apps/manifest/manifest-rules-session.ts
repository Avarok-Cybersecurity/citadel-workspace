/**
 * The manifest rules of `citadel.session` and its limits, rule for rule with
 * apps_manifest_session.rs (citadel-session-abi §2): `servers` is present exactly for
 * `citadel.session`, 1 to MAX_SESSION_SERVERS distinct canonical domains, and `limits.session`
 * exactly when `citadel.session` is asked for, within the SDK's ceilings. Each answers the reason
 * it refused, or null.
 */
import type { AppLimits, Capability, CapabilityRequest } from 'citadel-workspace-client-ts';
import { MAX_SESSION_SERVERS, SESSION_MAX_MSG_BYTES_CEILING, SESSION_MAX_MSGS_PER_S_CEILING } from '../sdk/generated/AbiConstants';
import { isCanonicalServer } from './canonical-domain';

export const takesServers = (cap: Capability): boolean => cap === 'citadel.session';

export function sessionCapabilitiesProblem(requests: readonly CapabilityRequest[]): string | null {
  for (const r of requests) {
    if ((r.servers !== undefined) !== takesServers(r.cap)) return `${r.cap}: servers where they do not belong`;
    const servers: string[] | undefined = r.servers;
    if (servers === undefined) continue;
    const ok: boolean = servers.length >= 1 && servers.length <= MAX_SESSION_SERVERS && servers.every(isCanonicalServer) && new Set(servers).size === servers.length;
    if (!ok) return `${r.cap}: servers`;
  }
  return null;
}

export function sessionLimitsProblem(limits: AppLimits, requests: readonly CapabilityRequest[]): string | null {
  if ((limits.session !== undefined) !== requests.some((r: CapabilityRequest) => takesServers(r.cap))) return 'session';
  if (limits.session === undefined) return null;
  const within = (v: number, max: number): boolean => Number.isInteger(v) && v >= 1 && v <= max;
  if (!within(limits.session.max_msg_bytes, SESSION_MAX_MSG_BYTES_CEILING)) return 'session.max_msg_bytes';
  if (!within(limits.session.max_msgs_per_s, SESSION_MAX_MSGS_PER_S_CEILING)) return 'session.max_msgs_per_s';
  return null;
}
