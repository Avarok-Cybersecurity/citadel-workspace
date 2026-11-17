/**
 * "A window wants this peer connected": the supervised replacement for dialling.
 *
 * An open chat or a call sends Interest to the agent, which decides whether,
 * when and how to dial. The window never waits on the outcome: the request is
 * sent without an answer to wait for, and a failure to send is logged, not
 * thrown, so "Send" is never held up by it. Interest expires on its own at
 * `until`, so a window that closes (or a tab that dies) needs no goodbye; a
 * window that stays renews it at half the lifetime.
 */
import { sendToAgent } from '../agent-conversations/sender';
import { agentSupervisesP2p } from '../agent-conversations/capabilities';
import { INTEREST_COMMAND } from '@/types/agent-supervisor';
import { eventEmitter } from '../event-emitter';
import { SESSION_CLAIMED, type ClaimedEvent } from '../multi-instance/claim-relay';
import { debugLog } from '../debug-config';

/** How long one Interest holds without renewal. */
export const INTEREST_LIFETIME_MS: number = 60_000;

/** The request that tells the agent a window wants `peerCid` connected until `untilMs`. */
export function interestRequest(requestId: string, cid: bigint, peerCid: bigint, untilMs: number): Record<string, unknown> {
  return {
    ConnectionManagement: {
      request_id: requestId,
      management_command: { [INTEREST_COMMAND]: { session_cid: cid, peer_cid: peerCid, until: BigInt(untilMs) } },
    },
  };
}

/** Tells a supervising agent that `peerCid` is wanted for the next lifetime; does nothing for an agent that does not supervise. */
export async function declareInterest(sessionCid: bigint, peerCid: bigint, now: number): Promise<void> {
  if (!(await agentSupervisesP2p())) return;
  try {
    await sendToAgent(interestRequest(crypto.randomUUID(), sessionCid, peerCid, now + INTEREST_LIFETIME_MS));
  } catch (error: unknown) {
    // A later renewal tries again; nothing waits on this send, so there is no caller to tell.
    debugLog('AgentSupervisor', `Interest in ${peerCid.toString().slice(0, 8)}... was not sent:`, error);
  }
}

/**
 * Keeps the interest alive until the returned function is called. The agent
 * holds it per connection, so a claim of this session on a new connection says
 * it again rather than leaving the peer undialled until the next renewal.
 */
export function holdInterest(sessionCid: bigint, peerCid: bigint): () => void {
  const send = (): void => { void declareInterest(sessionCid, peerCid, Date.now()); };
  send();
  const timer: ReturnType<typeof setInterval> = setInterval(send, INTEREST_LIFETIME_MS / 2);
  const stopHearingClaims: () => void = eventEmitter.on<ClaimedEvent>(SESSION_CLAIMED, ({ cid }: ClaimedEvent): void => {
    if (cid === sessionCid) send();
  });
  return (): void => { clearInterval(timer); stopHearingClaims(); };
}
