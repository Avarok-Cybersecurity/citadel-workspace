/**
 * The call a failed call would place again: the same people, the same home, with video only if
 * this side had it. Null when the failed call knows nobody to call (nothing to offer then).
 */
import type { CallHome, CallParticipant, CallPeerRef, CallState } from './call-state';

export interface CallAgain {
  readonly peers: CallPeerRef[];
  readonly video: boolean;
  readonly home: CallHome;
}

export function callAgainOf(call: CallState): CallAgain | null {
  const peers: CallPeerRef[] = [...call.participants.values()].map((p: CallParticipant): CallPeerRef => ({ cid: p.cid, username: p.username }));
  if (peers.length === 0) return null;
  return { peers, video: call.selfMedia.video, home: call.home };
}
