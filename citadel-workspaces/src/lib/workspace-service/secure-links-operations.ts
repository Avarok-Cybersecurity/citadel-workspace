/**
 * Secure links on the workspace protocol: every request is answered with
 * `WorkspaceProtocolResponse::SecureLinks`, and each call resolves with the answer that is ITS
 * answer -- the protocol has no request id, so an answer is taken for ours only when its kind fits
 * the request and, for an action on one link, it names that link.
 *
 * A refusal the server words (`Error`) rejects, as every write here does. `LinkUnavailable` and
 * `LimitReached` are answers, not failures, and resolve as outcomes the caller must handle.
 */
import type {
  LinkGrant, LinkLifetime, SecureLinkInfo, SecureLinksRequest, SecureLinksResponse,
} from 'citadel-workspace-client-ts';
import { awaitWriteResponse } from './await-write-response';
import type { ProtocolSender } from './workspace-operations';
import type { LinkQuota } from '@/lib/share/link-lifetime';

export interface SecureLinksListing {
  links: SecureLinkInfo[];
  quota: LinkQuota;
}

export interface NewSecureLink {
  target: string;
  label: string;
  grants: LinkGrant[];
  lifetime: LinkLifetime;
}

export type CreateOutcome =
  | { kind: 'created'; info: SecureLinkInfo; token: string }
  | { kind: 'limit-reached'; perMember: number; pool: number };
export type RegenerateOutcome = { kind: 'regenerated'; info: SecureLinkInfo; token: string } | { kind: 'unavailable' };
export type ExtendOutcome = { kind: 'extended'; info: SecureLinkInfo } | { kind: 'unavailable' };
export type DeleteOutcome = { kind: 'deleted' } | { kind: 'unavailable' };
export type ResolveOutcome = { kind: 'resolved'; target: string } | { kind: 'unavailable' };

const KINDS: readonly string[] = ['Created', 'Regenerated', 'Extended', 'Deleted', 'Links', 'Resolved', 'LimitReached'];

/** The secure-links answer a payload carries, or null for anything else. */
export function secureLinksAnswer(payload: unknown): SecureLinksResponse | null {
  if (payload === 'LinkUnavailable') return 'LinkUnavailable';
  if (!payload || typeof payload !== 'object') return null;
  const keys: string[] = Object.keys(payload);
  return keys.length === 1 && KINDS.includes(keys[0]) ? (payload as SecureLinksResponse) : null;
}

type Kind = 'Created' | 'Regenerated' | 'Extended' | 'Deleted' | 'Links' | 'Resolved' | 'LimitReached';
type Of<K extends Kind> = Extract<SecureLinksResponse, Record<K, unknown>>[K];

function variant<K extends Kind>(answer: SecureLinksResponse, kind: K): Of<K> | null {
  if (typeof answer !== 'object' || !(kind in answer)) return null;
  return (answer as Record<string, unknown>)[kind] as Of<K>;
}

async function exchange<T>(sender: ProtocolSender, request: SecureLinksRequest, read: (answer: SecureLinksResponse) => T | null): Promise<T> {
  let answered: T | null = null;
  await awaitWriteResponse('SecureLinks', () => sender.sendProtocolRequest({ SecureLinks: request }), (payload: unknown): boolean => {
    const answer: SecureLinksResponse | null = secureLinksAnswer(payload);
    answered = answer === null ? null : read(answer);
    return answered !== null;
  });
  if (answered === null) throw new Error('SecureLinks: the server\'s answer did not fit the request');
  return answered;
}

const unavailable = (answer: SecureLinksResponse): { kind: 'unavailable' } | null =>
  answer === 'LinkUnavailable' ? { kind: 'unavailable' } : null;

export function listSecureLinks(sender: ProtocolSender): Promise<SecureLinksListing> {
  return exchange(sender, 'List', (answer: SecureLinksResponse): SecureLinksListing | null => {
    const l: Of<'Links'> | null = variant(answer, 'Links');
    return l === null ? null : { links: l.links, quota: { live: l.live, perMember: l.per_member, pool: l.pool, poolUsed: l.pool_used } };
  });
}

export function createSecureLink(sender: ProtocolSender, link: NewSecureLink): Promise<CreateOutcome> {
  return exchange(sender, { Create: link }, (answer: SecureLinksResponse): CreateOutcome | null => {
    const made: Of<'Created'> | null = variant(answer, 'Created');
    if (made !== null) return made.info.target === link.target ? { kind: 'created', info: made.info, token: made.token } : null;
    const limit: Of<'LimitReached'> | null = variant(answer, 'LimitReached');
    return limit === null ? null : { kind: 'limit-reached', perMember: limit.per_member, pool: limit.pool };
  });
}

export function regenerateSecureLink(sender: ProtocolSender, id: string): Promise<RegenerateOutcome> {
  return exchange(sender, { Regenerate: { id } }, (answer: SecureLinksResponse): RegenerateOutcome | null => {
    const r: Of<'Regenerated'> | null = variant(answer, 'Regenerated');
    return r !== null && r.info.id === id ? { kind: 'regenerated', info: r.info, token: r.token } : unavailable(answer);
  });
}

export function extendSecureLink(sender: ProtocolSender, id: string, ttlMs: bigint): Promise<ExtendOutcome> {
  return exchange(sender, { Extend: { id, ttl_ms: ttlMs } }, (answer: SecureLinksResponse): ExtendOutcome | null => {
    const e: Of<'Extended'> | null = variant(answer, 'Extended');
    return e !== null && e.info.id === id ? { kind: 'extended', info: e.info } : unavailable(answer);
  });
}

export function deleteSecureLink(sender: ProtocolSender, id: string): Promise<DeleteOutcome> {
  return exchange(sender, { Delete: { id } }, (answer: SecureLinksResponse): DeleteOutcome | null => {
    const d: Of<'Deleted'> | null = variant(answer, 'Deleted');
    return d !== null && d.id === id ? { kind: 'deleted' } : unavailable(answer);
  });
}

export function resolveSecureLink(sender: ProtocolSender, token: string): Promise<ResolveOutcome> {
  return exchange(sender, { Resolve: { token } }, (answer: SecureLinksResponse): ResolveOutcome | null => {
    const r: Of<'Resolved'> | null = variant(answer, 'Resolved');
    return r !== null ? { kind: 'resolved', target: r.target } : unavailable(answer);
  });
}
