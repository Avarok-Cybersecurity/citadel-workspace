/**
 * The per-member P2P and topic requests (S2, p2p-demo-design §1, §7): a member's own consent and
 * block list for one install, the kernel's word on a peer before any frame is served or sent
 * (`AuthorizePeer`), and the group a topic rides (`TopicGroup`, first writer wins). Same
 * transport and strict answers as apps-operations.ts; an answer is ours only when it names what
 * we asked about.
 */
import type { PeerConsent, PeerDirection } from 'citadel-workspace-client-ts';
import { peerDirectionKey, type PeerAuthorization } from '@/lib/citadel-apps/member-consent-types';
import { ask, type AppsResult, type AppsTransport, type Of } from './apps-operations';

export interface ConsentChoice {
  readonly serve: boolean;
  readonly call: boolean;
  readonly topics: boolean;
}

export const setPeerConsentForMe = (t: AppsTransport, installId: string, c: ConsentChoice): Promise<AppsResult<PeerConsent>> =>
  ask(t, { SetPeerConsentForMe: { install_id: installId, serve: c.serve, call: c.call, topics: c.topics } }, 'peer-consent',
    (a: Of<'peer-consent'>) => a.installId === installId && a.consent.serve === c.serve && a.consent.call === c.call && a.consent.topics === c.topics,
    (a: Of<'peer-consent'>) => a.consent);

export const setPeerBlockedForMe = (t: AppsTransport, installId: string, username: string, blocked: boolean): Promise<AppsResult<boolean>> =>
  ask(t, { SetPeerBlockedForMe: { install_id: installId, username, blocked } }, 'peer-blocked',
    (a: Of<'peer-blocked'>) => a.installId === installId && a.username === username && a.blocked === blocked, (a: Of<'peer-blocked'>) => a.blocked);

/** The kernel's word on `peerCid` for `direction`; every refusal (it says only `NoHost`) is a plain no. */
export async function authorizePeer(t: AppsTransport, installId: string, peerCid: bigint, direction: PeerDirection): Promise<PeerAuthorization> {
  const r: AppsResult<PeerAuthorization> = await ask(t, { AuthorizePeer: { install_id: installId, peer_cid: peerCid, direction } }, 'peer-authorized',
    (a: Of<'peer-authorized'>) => a.installId === installId && a.peer.cid === peerCid && peerDirectionKey(a.direction) === peerDirectionKey(direction),
    (a: Of<'peer-authorized'>): PeerAuthorization => ({ ok: true, peer: a.peer, untilMs: a.untilMs }));
  return r.ok ? r.value : { ok: false, why: typeof r.refusal === 'string' ? r.refusal : JSON.stringify(r.refusal) };
}

/** The group id the kernel holds for `topic` (null: none), after claiming `claim` when it held none; `refused` when it would not say. */
export async function topicGroup(t: AppsTransport, installId: string, topic: string, claim: string | null): Promise<string | null | 'refused'> {
  const r: AppsResult<string | null> = await ask(t, { TopicGroup: { install_id: installId, topic, claim } }, 'topic-group',
    (a: Of<'topic-group'>) => a.installId === installId && a.topic === topic, (a: Of<'topic-group'>) => a.groupKey);
  return r.ok ? r.value : 'refused';
}
