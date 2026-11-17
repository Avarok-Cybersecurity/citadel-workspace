/**
 * A request that asks for a key touch waits for it.
 *
 * A Connect's budget is 30 s and a SignInManagement's the same, written for a
 * password round trip. The touch window is 60 s, and the answer comes only
 * after it. Each challenge for the request restarts the wait at the touch
 * window plus the budget, so a user still holding the key is never told
 * "timeout". Driven on the real event bus with fake timers; the agent is the
 * bus itself.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventEmitter } from '@/lib/event-emitter';
import { awaitConnectOutcome, type ConnectOutcome } from '@/lib/connection/await-connect-outcome';
import { manageSignIn, MANAGEMENT_TIMEOUT_MS } from '../management';

const challengeFor = (requestId: string): Record<string, unknown> => ({ SecurityKeyChallengeNotification: {
  cid: 0n, request_id: requestId, challenge_id: 'c', purpose: 'SignIn', allowed_credential_ids: [[1]], prf_salt: [2], expires_in_ms: 60000,
} });

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('a sign-in that asks for a touch', () => {
  it('outlives its 30 s budget while the touch window is open', async () => {
    const outcome: Promise<ConnectOutcome> = awaitConnectOutcome('r1', 30000);
    await vi.advanceTimersByTimeAsync(25000);
    eventEmitter.emit('websocket-message', challengeFor('r1'));
    await vi.advanceTimersByTimeAsync(60000);
    eventEmitter.emit('websocket-message', { ConnectSuccess: { cid: 7n, request_id: 'r1' } });
    await expect(outcome).resolves.toEqual({ kind: 'connected', cid: 7n });
  });

  it('still times out when nothing answers after the touch window', async () => {
    const outcome: Promise<ConnectOutcome> = awaitConnectOutcome('r2', 30000);
    const caught: Promise<unknown> = outcome.catch((e: unknown) => e);
    eventEmitter.emit('websocket-message', challengeFor('r2'));
    await vi.advanceTimersByTimeAsync(90001);
    expect(await caught).toEqual(new Error('Connection timeout'));
  });

  it('is not extended by another request\'s challenge', async () => {
    const caught: Promise<unknown> = awaitConnectOutcome('r3', 30000).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(25000);
    eventEmitter.emit('websocket-message', challengeFor('someone-else'));
    await vi.advanceTimersByTimeAsync(5001);
    expect(await caught).toEqual(new Error('Connection timeout'));
  });
});

describe('a SignInManagement that asks for a touch', () => {
  it('outlives its budget the same way', async () => {
    let requestId: string = '';
    const outcome: Promise<unknown> = manageSignIn(async (r: Record<string, unknown>): Promise<void> => {
      requestId = (r.SignInManagement as { request_id: string }).request_id;
    }, 7n, 'RegenerateRecoveryCodes', { password: null, security_key: true });
    await vi.advanceTimersByTimeAsync(MANAGEMENT_TIMEOUT_MS - 1000);
    eventEmitter.emit('websocket-message', challengeFor(requestId));
    await vi.advanceTimersByTimeAsync(60000);
    eventEmitter.emit('websocket-message', { SignInManagementSuccess: { cid: 7n, request_id: requestId, outcome: { RecoveryCodes: ['C'] } } });
    await expect(outcome).resolves.toEqual({ RecoveryCodes: ['C'] });
  });
});
