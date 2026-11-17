/**
 * 'p2p:channel-ready' is what drains the RE-VFS retry queue (operations queued while
 * a peer was unreachable, deletions among them). It was said once per peer for the
 * life of the page: the peer's link could drop and come back, and the service still
 * held it as ready, so the second readiness was swallowed and the queue sat until a
 * manual Sync. A peer whose link dropped is no longer ready.
 *
 * Real: the service singleton, its state, the event bus. Stood in, as the socket and
 * reads over it: the websocket service, the registration service, the connection manager.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

vi.mock('@/lib/websocket-service', () => ({ websocketService: {} }));
vi.mock('@/lib/p2p-registration-service', () => ({ p2pRegistrationService: {} }));
vi.mock('@/lib/connection', () => ({ connectionManager: {} }));

const { p2pAutoConnectService } = await import('@/lib/p2p-auto-connect-service');
const { eventEmitter } = await import('@/lib/event-emitter');

const OURS: bigint = 10n;
const PEER: bigint = 20n;
let ready: bigint[] = [];
let off: () => void;

beforeAll((): void => { off = eventEmitter.on<{ peerCid: bigint }>('p2p:channel-ready', ({ peerCid }): void => { ready.push(peerCid); }); });
afterAll((): void => { off(); });

describe('a peer channel', () => {
  it('is announced once while it stays up', () => {
    ready = [];
    p2pAutoConnectService.markChannelReady(PEER);
    p2pAutoConnectService.markChannelReady(PEER);
    expect(ready).toEqual([PEER]);
  });

  it('is announced again after the peer\'s link dropped and came back', () => {
    ready = [];
    p2pAutoConnectService.handlePeerDisconnect(OURS, PEER);
    expect(p2pAutoConnectService.isChannelReady(PEER)).toBe(false);
    p2pAutoConnectService.markChannelReady(PEER);
    expect(ready).toEqual([PEER]);
  });
});
