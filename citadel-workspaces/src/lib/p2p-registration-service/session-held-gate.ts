/**
 * The one check every ListAllPeers / ListRegisteredPeers passes before it is sent.
 *
 * Those requests name a session CID, and the agent refuses them for a CID it
 * does not hold ("Session for <cid> not found in session manager"). Tabs kept
 * asking for sessions the agent had dropped -- a restart, or a reconnect that
 * gave up -- from every poller that lists peers: tens of thousands of refusals
 * for a handful of CIDs. The agent's GetSessions answer is the authority (see
 * agent-holds-session): a CID it does not list is not asked about. A failed
 * GetSessions is not an answer, so it never blocks a request.
 *
 * The refusal is a SessionNotHeldError, which isSessionNotFoundRefusal
 * recognises, so the registration poll stops on it exactly as it stops on the
 * agent's own refusal, and announces the session gone.
 */
import { connectionManager } from '../connection';
import { agentLacksSession, SessionNotHeldError } from '@/lib/sessions/agent-holds-session';

export async function assertAgentHoldsSession(cid: bigint): Promise<void> {
  if (agentLacksSession(cid, await connectionManager.getActiveSessionsResult())) throw new SessionNotHeldError(cid);
}
