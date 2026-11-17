/**
 * Tests for handleWebSocketMessage — the router that turns internal-service
 * responses into peer-map state and pending-request resolutions.
 *
 * No module mocking: handleWebSocketMessage takes a RegistrationContext, so the
 * whole dependency surface is passed in by the caller.
 */
import { describe, it, expect, vi } from 'vitest';
import { handleWebSocketMessage , type RegistrationContext } from '../p2p-registration-service/registration';
import type { Peer, PendingRequestEntry } from '../p2p-registration-service/types';

function makeContext(): RegistrationContext & { pendingRequests: Map<string, PendingRequestEntry> } {
  return {
    pendingRequests: new Map<string, PendingRequestEntry>(),
    allPeers: new Map<bigint, Peer>(),
    registeredPeers: new Map<bigint, Peer>(),
    outgoingRegistrations: new Set<bigint>(),
    incomingRegistrations: new Set<bigint>(),
    handleIncomingRegistration: vi.fn(() => Promise.resolve()),
  };
}

/** Register a pending request and return a promise plus its settle state. */
function pend(ctx: RegistrationContext, requestId: string): Promise<Record<string, unknown>> {
  let resolve!: (v: Record<string, unknown>) => void;
  let reject!: (e: Error) => void;
  const promise: Promise<Record<string, unknown>> = new Promise<Record<string, unknown>>((res, rej): void => { resolve = res; reject = rej; });
  ctx.pendingRequests.set(requestId, { resolve, reject });
  return promise;
}

describe('handleWebSocketMessage', () => {
  it('resolves the pending request for a peer list response', async () => {
    const ctx: RegistrationContext & { pendingRequests: Map<string, PendingRequestEntry>; } = makeContext();
    const promise: Promise<Record<string, unknown>> = pend(ctx, 'req-1');

    handleWebSocketMessage(
      { ListAllPeersResponse: { request_id: 'req-1', peers: [] } } as never,
      ctx
    );

    await expect(promise).resolves.toMatchObject({ request_id: 'req-1' });
    expect(ctx.pendingRequests.size).toBe(0);
  });

  it('rejects the pending request when the peer list fails', async () => {
    const ctx: RegistrationContext & { pendingRequests: Map<string, PendingRequestEntry>; } = makeContext();
    const promise: Promise<Record<string, unknown>> = pend(ctx, 'req-2');

    handleWebSocketMessage(
      { ListAllPeersFailure: { request_id: 'req-2', message: 'no session' } } as never,
      ctx
    );

    await expect(promise).rejects.toThrow('no session');
  });

  it('records an outgoing registration on success', () => {
    const ctx: RegistrationContext & { pendingRequests: Map<string, PendingRequestEntry>; } = makeContext();

    handleWebSocketMessage(
      { PeerRegisterSuccess: { request_id: 'r', peer_cid: 42n, peer_username: 'bob' } } as never,
      ctx
    );

    expect(ctx.outgoingRegistrations.has(42n)).toBe(true);
    expect(ctx.registeredPeers.get(42n)).toMatchObject({ username: 'bob', isRegistered: true });
    // A newly registered peer must also appear in the full peer list, or the
    // directory shows it as unknown until the next poll.
    expect(ctx.allPeers.has(42n)).toBe(true);
  });

  it('treats "already registered" as success, not failure', async () => {
    // Documented invariant: after a reconnect our local state is stale, so
    // re-registering an existing peer is expected and must not surface as an error.
    const ctx: RegistrationContext & { pendingRequests: Map<string, PendingRequestEntry>; } = makeContext();
    const promise: Promise<Record<string, unknown>> = pend(ctx, 'req-3');

    handleWebSocketMessage(
      { PeerRegisterFailure: { request_id: 'req-3', peer_cid: 42n, message: 'Peer is already registered' } } as never,
      ctx
    );

    await expect(promise).resolves.toMatchObject({ peer_cid: 42n, already_registered: true });
    expect(ctx.outgoingRegistrations.has(42n)).toBe(true);
    expect(ctx.registeredPeers.has(42n)).toBe(true);
  });

  it('rejects a genuine registration failure', async () => {
    const ctx: RegistrationContext & { pendingRequests: Map<string, PendingRequestEntry>; } = makeContext();
    const promise: Promise<Record<string, unknown>> = pend(ctx, 'req-4');

    handleWebSocketMessage(
      { PeerRegisterFailure: { request_id: 'req-4', peer_cid: 42n, message: 'peer not found' } } as never,
      ctx
    );

    await expect(promise).rejects.toThrow('peer not found');
    expect(ctx.outgoingRegistrations.has(42n)).toBe(false);
    expect(ctx.registeredPeers.has(42n)).toBe(false);
  });

  it('upgrades a synthesized handle when the success carries a real username', () => {
    const ctx: RegistrationContext & { pendingRequests: Map<string, PendingRequestEntry>; } = makeContext();
    ctx.allPeers.set(42n, {
      cid: 42n, username: 'User 42', fullName: 'User 42', isOnline: true, isRegistered: false,
    });

    handleWebSocketMessage(
      { PeerRegisterSuccess: { request_id: 'r', peer_cid: 42n, peer_username: 'bob' } } as never,
      ctx
    );

    expect(ctx.allPeers.get(42n)?.username).toBe('bob');
  });

  it('ignores an unknown message shape without throwing', () => {
    const ctx: RegistrationContext & { pendingRequests: Map<string, PendingRequestEntry>; } = makeContext();
    expect(() => handleWebSocketMessage({ SomethingElse: {} } as never, ctx)).not.toThrow();
    expect(ctx.registeredPeers.size).toBe(0);
  });
});
