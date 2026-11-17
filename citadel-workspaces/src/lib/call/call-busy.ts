import type { CallState } from './call-state';

/**
 * Why a new call cannot start right now, or null if it can.
 *
 * This tab owns exactly one call. The group entry path has refused a second one
 * since it was written — `groupCallEntryMode` returns `busy` with a reason — but
 * the 1:1 path never did: the chat header gates its call buttons only on
 * whether the peer is connected, so from any OTHER conversation during an
 * active call, both call buttons were live.
 *
 * Pressing one re-entered `CallSession.start` with the `starting` promise
 * already settled, which overwrote `localStream` and `pump` WITHOUT stopping
 * either. The first stream was orphaned with the camera light on until a page
 * reload, two pumps fed one encoder, and the original peer never received a
 * CallEnd — they were evicted only by their own 20s silence timeout, believing
 * the other side had vanished.
 *
 * A failed call is deliberately not busy: it is over in every way except its
 * error panel still owing the user a reason, and letting it block a new call
 * would strand them with no way out. That rule is `groupCallEntryMode`'s and is
 * kept identical here on purpose — two different answers to "am I busy?" is the
 * bug this module exists to prevent.
 */
export function callBusyReason(call: CallState | null): string | null {
  if (!call) return null;
  if (call.status === 'ended' || call.status === 'failed') return null;
  return call.status === 'ringing-in'
    ? 'You have an incoming call.'
    : 'You are already in another call.';
}
