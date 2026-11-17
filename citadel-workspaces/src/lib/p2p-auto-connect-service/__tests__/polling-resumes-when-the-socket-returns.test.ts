/**
 * A dropped socket stops the auto-connect polls (nothing to dial over), and the
 * only thing that started them was the registration service's one-time
 * 'started' event. After an agent restart or a sleep/wake the socket came back,
 * the session was claimed, and the leader never dialled a peer or refreshed the
 * agent's view again until the page was reloaded. A logged-out session must not
 * be revived by the same reconnection.
 *
 * Real: setupEventListeners, the auto-connect state, the polls, the leader flag,
 * the event bus. Stood in, because each is a read or write over the WebSocket:
 * the websocket service, the registration service's peer lists and the connection manager.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

vi.mock('@/lib/websocket-service', () => ({ websocketService: {} }));
vi.mock('@/lib/p2p-registration-service', () => ({
  p2pRegistrationService: { listRegisteredPeers: async (): Promise<never[]> => [], listAllPeers: async (): Promise<never[]> => [] },
}));
vi.mock('@/lib/connection', () => ({ connectionManager: { getActiveSessions: async (): Promise<never[]> => [] } }));

const { instanceManager } = await import('@/lib/multi-instance/instance-manager');
const { AutoConnectState } = await import('@/lib/p2p-auto-connect-service/state');
const { setupEventListeners } = await import('@/lib/p2p-auto-connect-service/event-handlers');
const { stopPolling, stopBackendPolling } = await import('@/lib/p2p-auto-connect-service/polling');
const { eventEmitter } = await import('@/lib/event-emitter');

const state: InstanceType<typeof AutoConnectState> = new AutoConnectState();
const polling = (): boolean => state.pollingInterval !== null && state.backendPollInterval !== null;

beforeAll((): void => {
  vi.spyOn(instanceManager, 'isLeader', 'get').mockReturnValue(true);
  setupEventListeners(state, (): void => undefined, async (): Promise<void> => undefined);
});
afterAll((): void => { stopPolling(state); stopBackendPolling(state); vi.restoreAllMocks(); });

describe('the auto-connect polls', () => {
  it('start with the session, stop with the socket and start again with the next one', () => {
    eventEmitter.emit('p2p:registration-service-started');
    expect(polling()).toBe(true);
    eventEmitter.emit('websocket-disconnected', { reason: 'agent restarted' });
    expect(polling()).toBe(false);
    eventEmitter.emit('on-ws-connection-success');
    expect(polling()).toBe(true);
  });

  it('stay stopped for a session that was logged out', () => {
    eventEmitter.emit('p2p:registration-service-stopped');
    expect(polling()).toBe(false);
    eventEmitter.emit('on-ws-connection-success');
    expect(polling()).toBe(false);
  });
});
