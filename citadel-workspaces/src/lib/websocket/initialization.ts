/**
 * WebSocket Initialization
 *
 * Handles WASM client initialization, leader election, and WebSocket creation.
 * Extracted from websocket-service.ts to reduce file size.
 */

import { declareOnLeaderSocket, forgetCapabilities, leaderSocketFailedToOpen, watchGreeting, type Greeting } from '../agent-conversations/capabilities';
import { WorkspaceClient, type WorkspaceClientConfig, type InternalServiceRequest, type InternalServiceResponse } from 'citadel-workspace-client-ts';
import { installLeadershipListener } from './leadership-listener';
import { leaderInboundHandler } from './leader-inbound-handler';
import { eventEmitter } from '../event-emitter';
import { debugLog, errorLog } from '../debug-config';
import { setupDisconnectionHandler as setupDisconnection, setupSessionReleaseHandler as setupSessionRelease, closeLeaderSocket } from './leader-socket-teardown';
import { instanceChannel, instanceManager, leaderOutboundHandler } from '../multi-instance';
import { assertMayOpenSocket } from '../multi-instance/tab-staleness';
import { INTERVAL } from '../timeout-constants';
import type { ReconnectBackoff } from './reconnect-backoff';
import { LeaderReconnect, broadcastAgentSocketState } from './leader-reconnect';

// Global state key for preventing multiple WASM client initializations
export const GLOBAL_INIT_KEY: "__citadel_wasm_client_init__" = '__citadel_wasm_client_init__';

declare global {
  interface Window {
    [GLOBAL_INIT_KEY]?: {
      promise: Promise<void>;
      initialized: boolean;
      client: WorkspaceClient | null;
    };
  }
}

export interface InitializationConfig {
  websocketUrl: string;
  messageHandler?: (message: unknown) => void;
  errorHandler?: (error: Error) => void;
  onClientCreated: (client: WorkspaceClient) => void;
  onClientReset: () => void;
  releaseSession: (cid: bigint) => void;
  /** Spacing between socket opens; every open, from every path, asks it first. */
  reconnectBackoff: ReconnectBackoff;
  /** The service's init(): how the leader re-opens a socket it lost. */
  reopen: () => Promise<unknown>;
}

export class WebSocketInitialization {
  private leadershipListenerRegistered: boolean = false;

  private readonly config: InitializationConfig;
  /** Owned while leader, so demotion can close it; `creating` blocks doubles. */
  private leaderClient: WorkspaceClient | null = null;
  private creating: Promise<WorkspaceClient> | null = null;

  private readonly reconnect: LeaderReconnect;

  constructor(config: InitializationConfig) {
    this.config = config;
    this.reconnect = new LeaderReconnect({
      backoff: config.reconnectBackoff,
      wanted: (): boolean => instanceManager.isLeader && this.leaderClient === null,
      reopen: config.reopen,
      report: broadcastAgentSocketState,
    });
  }

  /**
   * Wait for leader election to settle.
   * Returns when we know if we're leader or follower.
   */
  async waitForLeaderElection(): Promise<void> {
    debugLog('WebSocketInit', `waitForLeaderElection: checking initial state isLeader=${instanceManager.isLeader}, leaderId=${instanceManager.leaderId}`);
    if (instanceManager.isLeader || instanceManager.leaderId) {
      debugLog('WebSocketInit', `waitForLeaderElection: already decided, returning immediately`);
      return;
    }

    const ELECTION_TIMEOUT_MS: number = INTERVAL.LEADER_ELECTION_MS;
    debugLog('WebSocketInit', `waitForLeaderElection: waiting up to ${ELECTION_TIMEOUT_MS}ms for leader election`);

    return new Promise<void>((resolve) => {
      let resolved: boolean = false;

      const handler = ({ isLeader, leaderId }: { isLeader: boolean; leaderId: string }): void => {
        if (!resolved) {
          resolved = true;
          eventEmitter.off('instance:leader-changed', handler);
          debugLog('WebSocketInit', `waitForLeaderElection: leader-changed event received: isLeader=${isLeader}, leaderId=${leaderId}`);
          resolve();
        }
      };

      eventEmitter.on('instance:leader-changed', handler);

      if (instanceManager.isLeader || instanceManager.leaderId) {
        if (!resolved) {
          resolved = true;
          eventEmitter.off('instance:leader-changed', handler);
          debugLog('WebSocketInit', `waitForLeaderElection: decided during setup, isLeader=${instanceManager.isLeader}, leaderId=${instanceManager.leaderId}`);
          resolve();
        }
      }

      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          eventEmitter.off('instance:leader-changed', handler);
          debugLog('WebSocketInit', `waitForLeaderElection: TIMEOUT after ${ELECTION_TIMEOUT_MS}ms - no leader detected`);
          if (!instanceManager.isLeader && !instanceManager.leaderId) {
            debugLog('WebSocketInit', `waitForLeaderElection: Will let InstanceChannel handle election`);
          }
          resolve();
        }
      }, ELECTION_TIMEOUT_MS);
    });
  }

  /**
   * Watch for promotion and demotion. Idempotent — safe from either init path.
   *
   * This lived inside `initializeAsFollower`, so a tab that BOOTED as leader
   * never registered it, and `closeLeaderClient` has no other caller: on
   * demotion it kept a live socket that dropped every frame it received.
   */
  registerLeadershipListener(): void {
    if (this.leadershipListenerRegistered) return;
    this.leadershipListenerRegistered = true;

    installLeadershipListener({
      createWebSocketAsLeader: () => this.createWebSocketAsLeader(),
      closeLeaderClient: () => this.closeLeaderClient(),
    });
  }

  /** Initialize as follower (no WebSocket). */
  initializeAsFollower(): void {
    debugLog('WebSocketInit', 'Follower tab: Skipping WebSocket creation, will proxy through leader');

    eventEmitter.emit('on-ws-connection-success');
    debugLog('WebSocketInit', 'Follower initialization complete');
  }

  /** Create WebSocket connection when this tab is the leader. */
  async createWebSocketAsLeader(): Promise<WorkspaceClient> {
    // Idempotent: a demoted-then-promoted tab would otherwise open a second
    // socket while the first is still live. closeLeaderClient waits on it too.
    if (this.leaderClient) return this.leaderClient;
    if (this.creating) return this.creating;
    // A superseded build never opens the browser's socket (tab-staleness.ts).
    assertMayOpenSocket((): void => instanceChannel.relinquishLeadership());
    this.creating = this.doCreateWebSocketAsLeader().finally(() => {
      this.creating = null;
    });
    return this.creating;
  }

  /**
   * Tear down the socket this tab owned while it was leader. Waits for an
   * in-flight build: leaderClient is null while the build awaits, so a demotion
   * mid-build closed nothing and left a live, deaf socket owned by a follower.
   */
  async closeLeaderClient(): Promise<void> {
    this.reconnect.cancel();
    if (this.creating) await this.creating.catch(() => undefined);
    const client: WorkspaceClient | null = this.leaderClient;
    if (!client) return;
    this.leaderClient = null;
    forgetCapabilities();
    await closeLeaderSocket(client);
    this.config.onClientReset();
    window[GLOBAL_INIT_KEY] = undefined;
  }

  private async doCreateWebSocketAsLeader(): Promise<WorkspaceClient> {
    const greeting: Greeting = watchGreeting();
    const inbound: (message: InternalServiceResponse) => void = leaderInboundHandler(this.config.messageHandler);
    const clientConfig: WorkspaceClientConfig = {
      websocketUrl: this.config.websocketUrl,
      messageHandler: (message) => { greeting.observe(message); inbound(message); },
      errorHandler: this.config.errorHandler,
      // The library's own reconnect calls restart() on the process-wide WASM
      // connection from whichever client scheduled it -- including clients this
      // file already discarded. A discarded client restarting tore down the live
      // client's connection, whose recovery restarted it back: two clients
      // killing each other's socket every second, for ever. Reconnection is
      // decided here, through reconnectBackoff, and nowhere else.
      sessionConfig: { autoReconnect: false },
    };

    this.config.reconnectBackoff.admitAttempt();

    try {
      debugLog('WebSocketInit', 'Creating WorkspaceClient with config', clientConfig);
      const client: WorkspaceClient = new WorkspaceClient(clientConfig);
      await client.init();
      // Before reporting up: a hosted account refuses claims on an undeclared socket (capabilities.ts).
      debugLog('WebSocketInit', (await declareOnLeaderSocket(client, greeting)) ? 'The agent hosts messaging' : 'The browser runs messaging');
      this.config.reconnectBackoff.connected();
      this.reconnect.connected();
      this.leaderClient = client;

      eventEmitter.emit('on-ws-connection-success');

      if (window[GLOBAL_INIT_KEY]) {
        window[GLOBAL_INIT_KEY].client = client;
      }

      leaderOutboundHandler.setWebSocketSendFunction(async (message: unknown) => {
        await client.sendDirectToInternalService(message as InternalServiceRequest);
      });
      debugLog('WebSocketInit', 'Registered send function with leader outbound handler');

      this.setupDisconnectionHandler(client);
      this.setupSessionReleaseHandler();

      this.config.onClientCreated(client);

      debugLog('WebSocketInit', 'WASM client initialization completed successfully');
      return client;
    } catch (error) {
      errorLog('Error initializing WorkspaceClient:', error);
      leaderSocketFailedToOpen(error);
      this.config.reconnectBackoff.attemptFailed();
      this.reconnect.lost();
      const errorMessage: string = error instanceof Error ? error.message : 'Failed to initialize WebSocket connection';
      eventEmitter.emit('connection-failure', { error: errorMessage });

      throw error;
    }
  }

  private setupDisconnectionHandler(client: WorkspaceClient): void {
    setupDisconnection(client, {
      clearClient: () => {
        this.config.reconnectBackoff.disconnected();
        this.reconnect.lost();
        this.leaderClient = null;
        forgetCapabilities();
        window[GLOBAL_INIT_KEY] = undefined;
      },
      onClientReset: () => this.config.onClientReset(),
      releaseSession: (cid: bigint) => this.config.releaseSession(cid),
    });
  }

  private setupSessionReleaseHandler(): void {
    setupSessionRelease({ releaseSession: (cid: bigint) => this.config.releaseSession(cid) });
  }
}
