/**
 * WebSocket Service - Barrel Export
 */
export type { WebSocketServiceConfig } from './types';
export { WebSocketServiceCore } from './core';
import { WebSocketServiceCore } from './core';
import { eventEmitter } from '../event-emitter';
import { errorLog } from '../debug-config';
import { instanceManager } from '../multi-instance/instance-manager';
import { installFollowerSessionClaims } from '../multi-instance/follower-session-claims';
import { isOwnedByALiveConnection } from '../sessions/claim-session';
import { instanceChannel } from '../multi-instance/instance-channel';
import { TIMEOUT } from '../timeout-constants';
import { installClaimRelay } from '../multi-instance/claim-relay';
import { installNoticesHeardRelay } from '../multi-instance/notices-heard-relay';
import { noticesHeard } from '../agent-conversations/capabilities';
import { installMediaFrameRelay } from '../multi-instance/media-frame-relay';

// Singleton instance - preserves original API
export const websocketService: WebSocketServiceCore = new WebSocketServiceCore();

// The leader carries every tab's sessions on its one connection; see follower-session-claims.ts.
installFollowerSessionClaims({
  on: (event: string, handler: (payload: unknown) => void): void => { eventEmitter.on(event, handler); },
  isLeader: (): boolean => instanceManager.isLeader,
  selfInstanceId: (): string => instanceManager.instanceId,
  instances: () => instanceManager.getAllInstances(),
  claim: (cid: bigint): Promise<unknown> => websocketService.claimSession(cid, true),
  isOwnedByALiveConnection,
  reportFailure: (cid: bigint, error: unknown): void => { errorLog('FollowerSessionClaims', `claiming ${cid} for another tab failed`, error); },
  requestReports: (): void => instanceChannel.requestCidReport(),
  unregister: (instanceId: string): void => instanceManager.unregisterInstance(instanceId),
  reportWindowMs: TIMEOUT.CID_REPORT_WINDOW_MS,
  schedule: (fn: () => void, ms: number): void => { setTimeout(fn, ms); },
});

// A claim made here is heard in every tab; see claim-relay.ts.
installClaimRelay({
  on: (event: string, handler: (payload: unknown) => void): void => { eventEmitter.on(event, handler); },
  send: (cid: bigint): void => instanceChannel.send({ type: 'session-claimed', targetInstanceId: '*', payload: { cid } }),
});

// A follower's call frames go out on the leader's socket; see media-frame-relay.ts.
installMediaFrameRelay({
  on: (event: string, handler: (payload: unknown) => void): void => { eventEmitter.on(event, handler); },
  isLeader: (): boolean => instanceManager.isLeader,
  sink: () => websocketService.getClient(),
});

// What the leader's agent says about its notifier reaches every tab; see notices-heard-relay.ts.
installNoticesHeardRelay({
  store: noticesHeard,
  isLeader: (): boolean => instanceManager.isLeader,
  send: (heard: boolean): void => instanceChannel.send({ type: 'notices-heard', targetInstanceId: '*', payload: { heard } }),
});
