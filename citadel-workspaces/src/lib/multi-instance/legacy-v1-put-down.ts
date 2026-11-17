/**
 * TEMPORARY. Delete this module, and its two calls in channel-leader-election.ts, in the
 * release after the one that introduced the channel envelope (`v`, channel-envelope.ts).
 * By then no tab of a protocol-1 build should still be open.
 *
 * Protocol-1 tabs (built before the envelope; their messages have no `v`) cannot learn the
 * new rules, so a protocol-2 tab must lead in a way they already accept:
 *
 * - It never follows a protocol-1 heartbeat. Following an old build is how a new tab ended up
 *   serving through code that cannot carry what it sends.
 * - Leading, and hearing a protocol-1 heartbeat, it takes the instance id one below that
 *   leader's, says so (instance-announce), and heartbeats at once. A protocol-1 leader keeps
 *   its leadership only against a HIGHER id and yields to a lower one (its split-brain rule),
 *   so it demotes on that heartbeat, closes its socket, and proxies through this tab. The
 *   regular heartbeat (INTERVAL.HEARTBEAT_MS, every 2 s) keeps it there.
 * - A protocol-1 claim is answered by a leader with its heartbeat, as any claim is.
 *
 * Proven against a frozen copy of the protocol-1 election and dispatch
 * (__tests__/fixtures/legacy-v1/).
 */
import { instanceManager } from './instance-manager';
import { instanceIdOf } from './version-skew';
import { sendHeartbeat, type LeaderElectionState } from './leadership-signals';
import { debugLog } from '@/lib/debug-config';
import type { ChannelMessage } from './channel-types';

export function onLegacyHeartbeat(state: LeaderElectionState, message: ChannelMessage): void {
  if (!instanceManager.isLeader) {
    debugLog('InstanceChannel', `Not following ${message.senderInstanceId}: it runs a protocol-1 build`);
    return;
  }
  const legacyId: bigint | null = instanceIdOf(message.senderInstanceId);
  if (legacyId === null || legacyId <= 0n) return;
  if (instanceManager.instanceIdAsBigInt >= legacyId) {
    const lower: string = (legacyId - 1n).toString();
    debugLog('InstanceChannel', `A protocol-1 tab ${message.senderInstanceId} also leads: taking id ${lower} so it yields`);
    instanceManager.takeLowerInstanceId(lower);
    instanceManager.setLeader(true, lower);
    state.send({ type: 'instance-announce', targetInstanceId: '*', payload: { cid: instanceManager.cid } });
  }
  sendHeartbeat(state);
}

export function onLegacyClaim(state: LeaderElectionState, message: ChannelMessage): void {
  if (!instanceManager.isLeader) {
    debugLog('InstanceChannel', `Not accepting ${message.senderInstanceId}'s claim: it runs a protocol-1 build`);
    return;
  }
  sendHeartbeat(state);
}
