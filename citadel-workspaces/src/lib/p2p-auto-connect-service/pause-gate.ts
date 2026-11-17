/**
 * Auto-connect's doors, closed for a paused contact.
 *
 * Every dial goes through `connectToPeer`, and every incoming PeerConnect
 * through `handleIncomingPeerConnect` (plus the leader's early "connected" mark
 * for sessions of other tabs). Each consults this before acting.
 */
import { pauseStatusOf } from '@/lib/p2p-pause/agent-storage';
import { mayDial, answerFor, type IncomingAnswer, type PauseStatus } from '@/lib/p2p-pause/pause-rules';
import { ownsSession } from './session-ownership';
import { websocketService } from '../websocket-service';
import { instanceManager } from '../multi-instance';
import { debugLog } from '@/lib/debug-config';

/**
 * Both ends are checked when both sessions are this browser's: `connectToPeer`
 * then dials on the PEER session's behalf, so that session's pause counts too.
 */
export async function dialIsBlocked(currentCid: bigint, peerCid: bigint): Promise<boolean> {
  if (!mayDial(await pauseStatusOf(currentCid, peerCid))) return true;
  if (!ownsSession(peerCid)) return false;
  const theirs: PauseStatus = await pauseStatusOf(peerCid, currentCid);
  return !mayDial(theirs);
}

export async function incomingAnswer(localCid: bigint, initiatorCid: bigint): Promise<IncomingAnswer> {
  return answerFor(await pauseStatusOf(localCid, initiatorCid));
}

/**
 * The third door: a link reported UP, whoever brought it up. Closing the first
 * two was not enough -- the SDK could complete a connection nobody here
 * accepted, and the agent then reports it like any other. A paused pair is not
 * admitted to the connection state (which is the ILM's idea of "connected"),
 * and the leader, which holds the socket, drops the link. An unreadable record
 * is not admitted either, but not dropped: the next poll re-asks.
 */
export async function linkAdmitted(localCid: bigint, peerCid: bigint): Promise<boolean> {
  const answer: IncomingAnswer = await incomingAnswer(localCid, peerCid);
  if (answer === 'decline' && instanceManager.isLeader) {
    websocketService.disconnectP2P(localCid, peerCid).catch((error: unknown): void => {
      debugLog('P2PAutoConnectService', `Could not drop the link to paused ${peerCid.toString().slice(0, 8)}...:`, error);
    });
  }
  return answer === 'accept';
}
