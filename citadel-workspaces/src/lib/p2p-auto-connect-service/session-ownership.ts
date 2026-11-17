import { instanceManager } from '../multi-instance';

/**
 * Whether this browser's WebSocket owns the given session.
 *
 * Multi-tab P2P legitimately initiates from the other side, because one
 * WebSocket owns both sessions. Across browsers it does not, and asking the
 * service to act on a session we do not own is refused outright.
 *
 * Answered from this browser's tabs -- this tab's session and the ones the
 * other tabs have registered -- and NOT from `GetSessions`. That lists every
 * session the AGENT holds, whichever connection holds it, so with two browsers
 * signed in to one agent every peer looked like ours: alice's page sent
 * PeerConnect for bob's session on every retry and the agent refused each one.
 */
export function ownsSession(cid: bigint): boolean {
  return instanceManager.cid === cid || instanceManager.findInstanceByCid(cid) !== null;
}
