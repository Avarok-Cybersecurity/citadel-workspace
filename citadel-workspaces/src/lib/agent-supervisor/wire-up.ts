/**
 * What this tab does once the agent says it supervises (loaded then, not at
 * start-up, so none of it is on the landing path): the polls and retries that
 * dial stand down (the GetSessions state poll is not a dialler and keeps running), and the supervisor's reports start being recorded.
 */
import { eventEmitter } from '../event-emitter';
import { instanceManager } from '../multi-instance';
import { LEADER_WIRE_EVENT } from '../websocket/leader-inbound-handler';
import { installSupervisorStatus } from './status';

export interface DialPolls {
  stopPolling: () => void;
  cancelAllRetries: () => void;
}

export function standDownAndListen(polls: DialPolls): void {
  polls.stopPolling();
  polls.cancelAllRetries();
  installSupervisorStatus({ bus: eventEmitter, isLeader: (): boolean => instanceManager.isLeader, wireEvent: LEADER_WIRE_EVENT });
}
