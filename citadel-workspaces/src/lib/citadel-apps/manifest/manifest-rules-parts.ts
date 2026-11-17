/**
 * The manifest's capability list, limits and artifact: apps_manifest_check_parts.rs, rule for
 * rule. Each answers the reason it refused, or null.
 */
import type { AppLimits, ArtifactLocation, ArtifactRef, CapabilityRequest } from 'citadel-workspace-client-ts';
import { isAppId } from '../app-identity';
import { MAX_CLOSE_GRACE_MS } from '../sdk/generated/AbiConstants';
import { isHostList, isHttpsUrl } from './net-rules';
import { peerCapabilitiesProblem, peerLimitsProblem, takesRoutes, takesTargets, takesTopics } from './manifest-rules-peer';

const MAX_WHY_CHARS: number = 200;
const MAX_CALL_TARGETS: number = 16;
const MAX_ROUTES: number = 64;
const MAX_ROUTE_BYTES: number = 256;
const METHODS: readonly string[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD'];
const MAX_LOCATIONS: number = 4;
const MAX_GITHUB_PATH_BYTES: number = 256;
const MAX_ARTIFACT_BYTES: number = 8 * 1024 * 1024;
/** The kernel's storage.node.authored quota (MAX_STORAGE_NODE_AUTHORED_BYTES); manifest-cases.json holds the two equal. */
const MAX_STORAGE_NODE_AUTHORED_BYTES: number = 256 * 1024;

export const distinct = (items: readonly string[]): boolean => new Set(items).size === items.length;

/** 1..=`max` characters, no surrounding whitespace, no control character but (if allowed) `\n`. */
export function plainText(text: string, max: number, newlines: boolean): boolean {
  const count: number = [...text].length;
  if (count < 1 || count > max || /^\p{White_Space}|\p{White_Space}$/u.test(text)) return false;
  return [...text].every((c: string) => !/\p{Cc}/u.test(c) || (newlines && c === '\n'));
}

export const lowerHex = (text: string, length: number): boolean => text.length === length && /^[0-9a-f]*$/.test(text);

/** `METHOD /path`, segments literal or `:name`, the last may be `*`, no `.` or `..`. */
export function isRoutePattern(route: string): boolean {
  const space: number = route.indexOf(' ');
  if (space === -1) return false;
  const method: string = route.slice(0, space);
  const path: string = route.slice(space + 1);
  if (route.length > MAX_ROUTE_BYTES || !METHODS.includes(method) || !path.startsWith('/')) return false;
  if (path === '/') return true;
  const segments: string[] = path.slice(1).split('/');
  return segments.every((s: string, i: number) => {
    const literal: boolean = s !== '' && s !== '.' && s !== '..' && /^[A-Za-z0-9._~-]+$/.test(s);
    const param: boolean = s.startsWith(':') && /^[a-z0-9_]+$/.test(s.slice(1));
    return literal || param || (i === segments.length - 1 && s === '*');
  });
}

export function capabilitiesProblem(appId: string, requests: readonly CapabilityRequest[]): string | null {
  if (requests.length === 0 || !distinct(requests.map((r: CapabilityRequest) => r.cap))) return 'the list is empty or names a capability twice';
  for (const r of requests) {
    if (!plainText(r.why, MAX_WHY_CHARS, false)) return `${r.cap}: why`;
    const takesHosts: boolean = r.cap === 'net.host' || r.cap === 'net.server';
    if ((r.hosts !== undefined) !== takesHosts || (r.routes !== undefined) !== takesRoutes(r.cap) || (r.targets !== undefined) !== takesTargets(r.cap) || (r.topics !== undefined) !== takesTopics(r.cap)) {
      return `${r.cap}: hosts, routes, targets or topics where they do not belong`;
    }
    if (r.hosts !== undefined && !isHostList(r.hosts)) return `${r.cap}: hosts`;
    if (r.routes !== undefined && !(r.routes.length >= 1 && r.routes.length <= MAX_ROUTES && r.routes.every(isRoutePattern) && distinct(r.routes))) return `${r.cap}: routes`;
    if (r.targets !== undefined && !(r.targets.length <= MAX_CALL_TARGETS && r.targets.every((t: string) => isAppId(t) && t !== appId) && distinct(r.targets))) return `${r.cap}: targets`;
  }
  const has = (cap: string): boolean => requests.some((r: CapabilityRequest) => r.cap === cap);
  if (has('net.host.private') && !has('net.host')) return 'net.host.private without net.host';
  return peerCapabilitiesProblem(requests);
}

export function limitsProblem(limits: AppLimits, requests: readonly CapabilityRequest[]): string | null {
  const within = (v: number, max: number): boolean => v >= 1 && v <= max;
  const checks: Array<[string, boolean]> = [
    ['memory_pages', within(limits.memory_pages, 4096)],
    ['max_call_rate_per_s', within(limits.max_call_rate_per_s, 200)],
    ['frame_budget_ms', within(limits.frame_budget_ms, 1000)],
    ['storage_user_bytes', limits.storage_user_bytes <= 1024 * 1024],
    ['storage_scope_bytes', limits.storage_scope_bytes <= 8 * 1024 * 1024],
    ['storage_node_authored_bytes', limits.storage_node_authored_bytes === undefined || limits.storage_node_authored_bytes <= MAX_STORAGE_NODE_AUTHORED_BYTES],
    ['close_grace_ms', within(limits.close_grace_ms, MAX_CLOSE_GRACE_MS)],
  ];
  return checks.find(([, ok]) => !ok)?.[0] ?? peerLimitsProblem(limits, requests);
}

const githubPart = (part: string): boolean => part.length >= 1 && part.length <= 100 && part !== '.' && part !== '..' && /^[A-Za-z0-9._-]+$/.test(part);

function locationOk(location: ArtifactLocation): boolean {
  if (location.kind === 'https') return isHttpsUrl(location.url, 2048);
  const [owner, name, ...rest] = location.repo.split('/');
  const repoOk: boolean = rest.length === 0 && name !== undefined && githubPart(owner) && githubPart(name);
  const pathOk: boolean = location.path.length <= MAX_GITHUB_PATH_BYTES && location.path.split('/').every(githubPart);
  return repoOk && lowerHex(location.commit, 40) && pathOk;
}

export function artifactProblem(artifact: ArtifactRef): string | null {
  if (!lowerHex(artifact.sha256, 64)) return 'sha256 is not 64 lowercase hex characters';
  if (artifact.bytes < 1 || artifact.bytes > MAX_ARTIFACT_BYTES) return 'bytes is not within 1..=8 MiB';
  const keys: string[] = artifact.locations.map((l: ArtifactLocation) => JSON.stringify(Object.entries(l).sort()));
  if (keys.length === 0 || keys.length > MAX_LOCATIONS || !distinct(keys)) return 'locations: none, more than four, or repeated';
  return artifact.locations.every(locationOk) ? null : 'a location is not an https URL or a pinned GitHub file';
}
