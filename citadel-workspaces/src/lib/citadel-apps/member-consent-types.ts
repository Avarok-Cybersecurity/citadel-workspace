/**
 * The page's own words for a member's P2P and topic answers; the records themselves are the
 * generated S2 types (citadel-workspace-client-ts: PeerConsent, PeerForMe, PeerDirection,
 * IhttpFrom).
 */
import type { IhttpFrom, PeerDirection } from 'citadel-workspace-client-ts';

/** What a member decides for one install: the three planes, each on its own. */
export type ConsentPlane = 'serve' | 'call' | 'topics';

/**
 * AuthorizePeer's answer. The kernel's every refusal is the one uniform `NoHost`; `why` keeps that,
 * or what stood in its way (its `Limit`, no answer), for this page's own log, never for the peer.
 */
export type PeerAuthorization =
  | { readonly ok: true; readonly peer: IhttpFrom; readonly untilMs: bigint }
  | { readonly ok: false; readonly why: string };

/** One key per question asked of a peer: an answer about another direction is not this one's. */
export const peerDirectionKey = (d: PeerDirection): string =>
  (d === 'Call' ? 'call' : 'Serve' in d ? `serve/${d.Serve.routes_digest}` : `topic/${d.Topic.topic}`);
