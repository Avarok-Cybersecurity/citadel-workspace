/**
 * Whether the agent, not this window, keeps this browser's peer links up.
 *
 * Asked by every path that would dial, retry or poll. An agent without the
 * `supervises_p2p` capability answers false and nothing changes for it. If the
 * agent's answer never comes because its socket never opened, nothing could be
 * dialled anyway; the answer is then false, so the old path fails and retries
 * exactly as it did before the capability existed.
 */
import { agentSupervisesP2p } from '../agent-conversations/capabilities';
import { debugLog } from '../debug-config';

export async function supervisedByAgent(): Promise<boolean> {
  try {
    return await agentSupervisesP2p();
  } catch (error: unknown) {
    debugLog('AgentSupervisor', 'agent supervision unknown:', error);
    return false;
  }
}

/**
 * For a window that wants `peerCid` up: tells a supervising agent so, and says
 * true. False means the agent does not supervise and the caller dials itself.
 * The Interest is not awaited: the caller never waits on the agent's dial.
 */
export async function keepThroughAgent(sessionCid: bigint, peerCid: bigint): Promise<boolean> {
  if (!(await supervisedByAgent())) return false;
  const { declareInterest } = await import('./interest');
  void declareInterest(sessionCid, peerCid, Date.now());
  return true;
}
