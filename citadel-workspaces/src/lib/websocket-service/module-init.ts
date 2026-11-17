/**
 * WebSocket Service - Module Initialization
 *
 * Creates and configures all operation module instances
 * for the WebSocketServiceCore class.
 */

import type { ChatSecurityLevel } from '@/lib/p2p/chat-advanced-settings';
import type { WorkspaceClient } from 'citadel-workspace-client-ts';
import { instanceManager, instanceChannel, instanceInboundRouter } from '../multi-instance';
import type { AckResult } from '../multi-instance/outbound-queue-types';
import {
  LocalDBOperations,
  SessionManagement,
  FilePicker,
  P2POperations,
  MessengerOperations,
  DisconnectOperations,
  AuthOperations,
  WebSocketInitialization,
  WorkspaceOperations,
} from '../websocket';
import { lazyTurnSource } from '../ice-servers/lazy-turn-source';
import { TIMEOUT } from '../timeout-constants';
import { ReconnectBackoff, AGENT_RECONNECT_BACKOFF, systemClock } from '../websocket/reconnect-backoff';
import { registerCapabilityRoute, type LeaderAnswer } from '../agent-conversations/capabilities';
import { registerConversationSender } from '../agent-conversations/sender';

export interface ServiceModules {
  localDB: LocalDBOperations;
  sessionMgmt: SessionManagement;
  filePicker: FilePicker;
  p2pOps: P2POperations;
  messengerOps: MessengerOperations;
  disconnectOps: DisconnectOperations;
  authOps: AuthOperations;
  initOps: WebSocketInitialization;
  workspaceOps: WorkspaceOperations;
}

export interface ServiceCallbacks {
  init: () => Promise<void>;
  sendRequest: (req: Record<string, unknown>, reqId?: string) => Promise<void>;
  sendMessage: (msg: Record<string, unknown>) => Promise<void>;
  claimSession: (cid: bigint, onlyIfOrphaned: boolean) => Promise<unknown>;
  disconnect: (cid: bigint) => Promise<void>;
  releaseSession: (cid: bigint) => void;
  getClient: () => WorkspaceClient | null;
  onClientCreated: (client: WorkspaceClient) => void;
  onClientReset: () => void;
}

export function createServiceModules(
  websocketUrl: string,
  messageHandler: ((message: unknown) => void) | undefined,
  errorHandler: ((error: Error) => void) | undefined,
  callbacks: ServiceCallbacks
): ServiceModules {
  const moduleConfig: { init: () => Promise<void>; sendRequest: (req: unknown, reqId?: string) => Promise<void>; getClient: () => WorkspaceClient | null; } = {
    init: callbacks.init,
    sendRequest: (req: unknown, reqId?: string): Promise<void> => callbacks.sendRequest(req as Record<string, unknown>, reqId),
    getClient: callbacks.getClient,
  };

  // A follower learns from the leader what its socket was told; every window asks the agent for its conversations.
  registerCapabilityRoute({ isLeader: () => instanceManager.isLeader, askLeader: askLeaderForCapabilities });
  registerConversationSender(callbacks.sendRequest);

  const localDB: LocalDBOperations = new LocalDBOperations(moduleConfig);
  const sessionMgmt: SessionManagement = new SessionManagement(moduleConfig);
  const filePicker: FilePicker = new FilePicker(moduleConfig);

  const workspaceOps: WorkspaceOperations = new WorkspaceOperations({
    init: callbacks.init,
    getClient: callbacks.getClient,
  });

  const p2pOps: P2POperations = new P2POperations({
    init: callbacks.init,
    sendMessage: (msg: unknown) => callbacks.sendMessage(msg as Record<string, unknown>),
    isLeader: () => instanceManager.isLeader,
    turnFor: lazyTurnSource(async () => (await import('../ice-servers/workspace-turn-source')).createWorkspaceTurnSource({
      send: (cid: bigint, request: 'GetIceServers'): Promise<void> => workspaceOps.sendWorkspaceRequest(cid, request),
      timeoutMs: TIMEOUT.SERVER_REQUEST_MS,
    })),
    // Loaded on the first PeerConnect, like the relay lookup: this module is on
    // the landing page's critical path and the chat settings are not.
    securityFor: async (cid: bigint, peerCid: bigint): Promise<ChatSecurityLevel> =>
      (await import('@/lib/p2p/chat-advanced-settings')).chatAdvancedSettings.openingLevel(cid, peerCid),
  });

  const messengerOps: MessengerOperations = new MessengerOperations({
    init: callbacks.init,
    getClient: callbacks.getClient,
  });

  const disconnectOps: DisconnectOperations = new DisconnectOperations({
    init: callbacks.init,
    sendRequest: (req: unknown, reqId?: string) => callbacks.sendRequest(req as Record<string, unknown>, reqId),
  });

  const authOps: AuthOperations = new AuthOperations({
    init: callbacks.init,
    sendRequest: (req: unknown, reqId?: string) => callbacks.sendRequest(req as Record<string, unknown>, reqId),
    claimSession: callbacks.claimSession,
    disconnect: callbacks.disconnect,
  });

  const initOps: WebSocketInitialization = new WebSocketInitialization({
    websocketUrl,
    messageHandler,
    errorHandler,
    onClientCreated: callbacks.onClientCreated,
    onClientReset: callbacks.onClientReset,
    releaseSession: callbacks.releaseSession,
    reconnectBackoff: new ReconnectBackoff(AGENT_RECONNECT_BACKOFF, systemClock),
    reopen: callbacks.init,
  });

  return {
    localDB,
    sessionMgmt,
    filePicker,
    p2pOps,
    messengerOps,
    disconnectOps,
    authOps,
    initOps,
    workspaceOps,
  };
}

export async function askLeaderForCapabilities(): Promise<LeaderAnswer> {
  const requestId: string = crypto.randomUUID();
  instanceInboundRouter.registerPendingRequest(requestId, instanceManager.instanceId);
  const result: AckResult = await instanceChannel.sendToLeader({ __agentCapabilitiesProxy: true }, requestId);
  if (result.status === 'error') throw new Error(`The leader could not say what the agent hosts: ${result.error}`);
  const data: unknown = result.data;
  const said: { agentIlm?: unknown; supervisesP2p?: unknown; stagesUploads?: unknown; nativePicker?: unknown; takesConsole?: unknown; servesApps?: unknown; noticesHeard?: unknown } = typeof data === 'object' && data !== null ? data : {};
  // A leader from an older build does not say: nothing is taken to show the agent's notices, to stage, to take console lines, or to serve apps.
  return { agentIlm: said.agentIlm === true, supervisesP2p: said.supervisesP2p === true, stagesUploads: said.stagesUploads === true, nativePicker: typeof said.nativePicker === 'boolean' ? said.nativePicker : undefined, takesConsole: said.takesConsole === true, servesApps: said.servesApps === true, noticesHeard: said.noticesHeard === true };
}
