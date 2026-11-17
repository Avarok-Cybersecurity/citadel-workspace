/**
 * The `AppsResponse` variants of per-member P2P and topics (S2, citadel-workspace-types
 * `apps::peer`), read as strictly as apps-runtime-answer.ts reads its own: a member's consent, a
 * block-list change, the kernel's word on a peer, and a topic's group. Anything not exactly one of
 * these is not one of these.
 */
import type { IhttpFrom, PeerConsent, PeerDirection, PeerForMe } from 'citadel-workspace-client-ts';
import { exactly, isString, single } from './install-shape';

export type PeerAnswer =
  | { kind: 'peer-consent'; installId: string; consent: PeerConsent }
  | { kind: 'peer-blocked'; installId: string; username: string; blocked: boolean }
  | { kind: 'peer-authorized'; installId: string; peer: IhttpFrom; direction: PeerDirection; untilMs: bigint }
  | { kind: 'topic-group'; installId: string; topic: string; groupKey: string | null };

const isU64 = (v: unknown): v is bigint => typeof v === 'bigint' && v >= 0n && v < 2n ** 64n;
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
// Undefined as well as null: an Option the wasm client hands over as `None` arrives undefined.
const optionalString = (v: unknown): boolean => v === null || v === undefined || isString(v);
const isFrom = (v: unknown): v is IhttpFrom => exactly(v, { username: isString, cid: isU64, app_id: isString, install_id: isString });
export const isPeerConsent = (v: unknown): v is PeerConsent => exactly(v, { serve: isBool, call: isBool, topics: isBool, at_ms: isU64 });
const isDirection = (v: unknown): boolean =>
  v === 'Call' || single(v, 'Serve', (x: unknown) => exactly(x, { routes_digest: isString })) || single(v, 'Topic', (x: unknown) => exactly(x, { topic: isString }));
export const isPeerForMe = (v: unknown): v is PeerForMe =>
  exactly(v, { install_id: isString, consent: isPeerConsent, blocked: (b: unknown) => Array.isArray(b) && b.every(isString) });

type Json = Record<string, unknown>;
const inner = (payload: unknown, name: string): Json => (payload as Record<string, Json>)[name];

export function readPeerAnswer(payload: unknown): PeerAnswer | null {
  if (single(payload, 'PeerConsentForMe', (x: unknown) => exactly(x, { install_id: isString, consent: isPeerConsent }))) {
    const c: Json = inner(payload, 'PeerConsentForMe');
    return { kind: 'peer-consent', installId: c.install_id as string, consent: c.consent as PeerConsent };
  }
  if (single(payload, 'PeerBlockedForMe', (x: unknown) => exactly(x, { install_id: isString, username: isString, blocked: isBool }))) {
    const b: Json = inner(payload, 'PeerBlockedForMe');
    return { kind: 'peer-blocked', installId: b.install_id as string, username: b.username as string, blocked: b.blocked as boolean };
  }
  if (single(payload, 'PeerAuthorized', (x: unknown) => exactly(x, { install_id: isString, peer: isFrom, direction: isDirection, until_ms: isU64 }))) {
    const a: Json = inner(payload, 'PeerAuthorized');
    return { kind: 'peer-authorized', installId: a.install_id as string, peer: a.peer as IhttpFrom, direction: a.direction as PeerDirection, untilMs: a.until_ms as bigint };
  }
  if (single(payload, 'TopicGroup', (x: unknown) => exactly(x, { install_id: isString, topic: isString, group_key: optionalString }))) {
    const t: Json = inner(payload, 'TopicGroup');
    return { kind: 'topic-group', installId: t.install_id as string, topic: t.topic as string, groupKey: (t.group_key ?? null) as string | null };
  }
  return null;
}
