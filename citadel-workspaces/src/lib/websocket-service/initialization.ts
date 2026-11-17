/**
 * WebSocket Service - Initialization Logic
 *
 * Handles WebSocket client initialization, leader/follower election,
 * and WASM debug bridge setup.
 */

import type { WorkspaceClient } from 'citadel-workspace-client-ts';
import { debugLog } from '../debug-config';
import { instanceManager } from '../multi-instance';
import { GLOBAL_INIT_KEY } from '../websocket';
import type { WebSocketServiceCore } from './core';

/**
 * Initialize the WebSocket service.
 * Handles dedup via global state and concurrent init prevention.
 */
export async function initService(service: WebSocketServiceCore): Promise<void> {
  // A follower's initialisation opened no socket. Promoted, this tab is a leader without one,
  // and taking that for "initialised" let a request reach sendRequest before the socket the
  // promotion opens existed, to be refused there. Initialise again, as the leader it now is.
  const initialisedAsFollower: boolean = service.isInitialized || window[GLOBAL_INIT_KEY]?.initialized === true;
  if (instanceManager.isLeader && initialisedAsFollower && !service.client && !window[GLOBAL_INIT_KEY]?.client) {
    resetService(service);
  }

  if (window[GLOBAL_INIT_KEY]?.initialized) {
    service.isInitialized = true;
    if (window[GLOBAL_INIT_KEY].client) {
      service.client = window[GLOBAL_INIT_KEY].client;
    }
    return;
  }

  if (service.isInitialized) {
    debugLog('WebSocketService', 'Service already initialized');
    return;
  }

  if (service.initializationPromise) {
    debugLog('WebSocketService', 'Service initialization already in progress, waiting...');
    return service.initializationPromise;
  }

  service.initializationPromise = doInit(service);
  window[GLOBAL_INIT_KEY] = {
    promise: service.initializationPromise,
    initialized: false,
    client: null,
  };

  try {
    await service.initializationPromise;
    if (window[GLOBAL_INIT_KEY]) {
      window[GLOBAL_INIT_KEY].initialized = true;
    }
  } catch (error) {
    window[GLOBAL_INIT_KEY] = undefined;
    // The in-flight guard above returns this promise to every later caller. Left
    // set, a first failure is replayed for ever: the user starts the agent the
    // error told them to start, presses Retry, and the same stale rejection
    // comes back instantly without anything re-attempting. Only a page reload
    // recovered. Clearing it is what makes a retry an actual second attempt.
    service.initializationPromise = null;
    throw error;
  }
}

async function doInit(service: WebSocketServiceCore): Promise<void> {
  debugLog('WebSocketService', 'WASM client initialization starting...');

  const { setupWasmDebugBridge } = await import('../wasm-debug-bridge');
  setupWasmDebugBridge();

  debugLog('WebSocketService', 'Waiting for leader election to settle...');
  await service.initOps.waitForLeaderElection();

  // Before the branch, so a tab that boots as LEADER is also wired for
  // demotion. Registering it only on the follower path left a demoted
  // boot-leader holding a live socket that dropped every frame it received.
  service.initOps.registerLeadershipListener();

  const isLeader: boolean = instanceManager.isLeader;
  debugLog('WebSocketService', `Leader election complete. This tab is ${isLeader ? 'LEADER' : 'FOLLOWER'}`);

  if (!isLeader) {
    service.initOps.initializeAsFollower();
    service.isInitialized = true;
    service.client = null;
    return;
  }

  service.client = await service.initOps.createWebSocketAsLeader();
  service.isInitialized = true;
}

/**
 * Wait for WebSocket initialization to complete.
 * Returns immediately if already initialized.
 */
export async function waitForInit(service: WebSocketServiceCore): Promise<void> {
  if (service.isInitialized && service.client) {
    return;
  }

  if (window[GLOBAL_INIT_KEY]?.initialized && window[GLOBAL_INIT_KEY]?.client) {
    service.isInitialized = true;
    service.client = window[GLOBAL_INIT_KEY].client as WorkspaceClient;
    return;
  }

  if (service.initializationPromise) {
    await service.initializationPromise;
    return;
  }

  if (window[GLOBAL_INIT_KEY]?.promise) {
    await window[GLOBAL_INIT_KEY].promise;
    if (window[GLOBAL_INIT_KEY]?.client) {
      service.client = window[GLOBAL_INIT_KEY].client as WorkspaceClient;
      service.isInitialized = true;
    }
    return;
  }

  await initService(service);
}

/**
 * Reset the WebSocket service state to allow re-initialization.
 */
export function resetService(service: WebSocketServiceCore): void {
  debugLog('WebSocketService', 'Resetting WebSocket service state for reconnection');
  service.client = null;
  service.isInitialized = false;
  service.initializationPromise = null;
  window[GLOBAL_INIT_KEY] = undefined;
  debugLog('WebSocketService', 'WebSocket service state reset complete');
}
