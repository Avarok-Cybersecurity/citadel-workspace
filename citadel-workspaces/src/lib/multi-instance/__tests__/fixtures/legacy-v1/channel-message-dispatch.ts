// Frozen protocol-1 copy; see ./provenance.ts. Never edit: it stands for tabs already open.
/**
 * Routing a channel message to its handler.
 *
 * Split out of `InstanceChannel` so the class holds the socket lifecycle and
 * this holds the switch — the two change for entirely different reasons.
 */

import { debugLog } from '@/lib/debug-config';
import type { ChannelMessage } from '../../../channel-types';
import {
  handleOutboundRequest,
  handleOutboundAck,
  handleInboundForward,
  handleInboundAck,
  handleInstanceAnnounce,
  handleInstanceGoodbye,
  handleSessionRelease,
  handleCidUpdate,
} from './channel-messaging';
import { handleLeaderElection, handleLeaderHeartbeat , type LeaderElectionState } from './channel-leader-election';
import { recordRemoteExecution } from '../../../executed-requests';
import { applyLeaderSocketReport, readAgentSocketState, type AgentSocketState } from '../../../agent-socket-state';
import { instanceManager } from '../../../instance-manager';
import { eventEmitter } from '../../../../event-emitter';
import { claimedFromChannel, SESSION_CLAIMED, type ClaimedEvent } from '../../../claim-relay';
import { noticesHeardFromChannel } from '../../../notices-heard-relay';
import { noticesHeard } from '../../../../agent-conversations/capabilities';

export function dispatchChannelMessage(
  message: ChannelMessage,
  electionState: LeaderElectionState,
  broadcastCid: () => void
): void {
  if (message.type !== 'leader-heartbeat') {
    debugLog('InstanceChannel', `[InstanceChannel] Received ${message.type} from ${message.senderInstanceId}`);
  }

  switch (message.type) {
    case 'outbound-request': handleOutboundRequest(message); break;
    case 'outbound-ack': handleOutboundAck(message); break;
    case 'inbound-forward': handleInboundForward(message); break;
    case 'inbound-ack': handleInboundAck(message); break;
    case 'leader-election': handleLeaderElection(electionState, message); break;
    case 'leader-heartbeat': handleLeaderHeartbeat(electionState, message); break;
    case 'instance-announce': handleInstanceAnnounce(electionState, message); break;
    case 'instance-goodbye': handleInstanceGoodbye(electionState, message); break;
    case 'session-release': handleSessionRelease(message); break;
    case 'cid-update': handleCidUpdate(message); break;
    // Self-heal: leader missed our cid-update. No `instanceManager.cid` guard so
    // broadcastCid()'s tab-context fallback runs — post claim/reload owners
    // (CID not yet in instanceManager) still answer; the old guard stranded them.
    case 'cid-report-request': broadcastCid(); break;
    // Another tab's leader began executing this request id. Recorded in every
    // tab, leader or not: whoever wins the next flap needs the history, and
    // BroadcastChannel never echoes to the sender, so a tab's own completed
    // ids are never recorded here.
    case 'request-executed':
      if (message.requestId) recordRemoteExecution(message.requestId);
      break;
    case 'session-claimed': {
      const claimed: ClaimedEvent | null = claimedFromChannel(message.payload);
      if (claimed) eventEmitter.emit<ClaimedEvent>(SESSION_CLAIMED, claimed);
      break;
    }
    case 'notices-heard': {
      // The leader holds what its own socket said; a follower takes the leader's word.
      const heard: boolean | null = noticesHeardFromChannel(message.payload);
      if (heard !== null && !instanceManager.isLeader) noticesHeard.set(heard);
      break;
    }
    case 'agent-socket': {
      // The leader applies its own report; a stale one from a demoted tab is not news here.
      const state: AgentSocketState | null = readAgentSocketState(message.payload);
      if (state && !instanceManager.isLeader) applyLeaderSocketReport(state);
      break;
    }
  }
}
