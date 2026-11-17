/**
 * When the callee declines, the caller is told -- and a straggler cannot unsay it.
 *
 * Seen on the live bench: bob declined, and alice's outgoing call simply
 * vanished. The sentence for it exists ("bob declined the call.",
 * call-outcome-message) and is chosen from `CallState.reason`, which the
 * reducer set on the decline -- and then let any later event overwrite. A
 * terminal call is not over twice: a CallEnd arriving after the CallDecline
 * (the reliable layer redelivers, and a peer tearing down says goodbye), or a
 * local end('hangup') from a surface unmounting, re-ran the "everyone gone"
 * rule and replaced 'rejected' with 'hangup' -- which, correctly, says nothing.
 * Two signals handled before the manager's teardown microtask reach the same
 * manager, and the provider renders the state it ends up with.
 *
 * Terminal is now terminal: the first outcome is the one that stands.
 */
import { describe, it, expect, vi } from 'vitest';
import { CallManager } from '../call-manager';
import { callOutcomeMessage, callOutcomePeerName } from '../call-outcome-message';
import type { CallTransport } from '../call-transport';
import type { CallState } from '../call-state';
import { DIRECT_CALL } from '../call-state';

const BOB: bigint = 2n;

function caller(): { manager: CallManager; callId: () => string } {
  const transport: CallTransport = {
    openSession: vi.fn().mockResolvedValue(undefined),
    closeSession: vi.fn().mockResolvedValue(undefined),
    sendFrame: vi.fn(),
    sendSignal: vi.fn().mockResolvedValue(undefined),
  } as unknown as CallTransport;
  const manager: CallManager = new CallManager({
    transport,
    selfCid: 1n,
    capabilities: { audio: ['opus'], video: [] },
    now: () => 0,
    // No timer is allowed to fire: the outcome under test is the decline's.
    schedule: () => () => undefined,
    onStateChanged: () => undefined,
    resolvePeerName: (cid: bigint) => `peer-${cid}`,
    onKeyframeRequested: () => undefined,
  });
  return { manager, callId: () => manager.getState()?.callId ?? '' };
}

function told(state: CallState | null): string | null {
  if (!state) throw new Error('the call has no state');
  return callOutcomeMessage(state.reason, callOutcomePeerName(state));
}

describe('a callee who declines', () => {
  it('leaves the caller a sentence saying so', async () => {
    const { manager, callId } = caller();
    await manager.start('c1', [{ cid: BOB, username: 'bob0924' }], { audio: true, video: false, screen: false }, DIRECT_CALL, null);
    await manager.handleSignal(BOB, 'bob0924', { kind: 'CallDecline', call_id: callId(), reason: 'rejected' });

    expect(manager.getState()?.status).toBe('ended');
    expect(told(manager.getState())).toBe('bob0924 declined the call.');
  });

  it("is not overwritten by the callee's goodbye arriving after it", async () => {
    const { manager, callId } = caller();
    await manager.start('c1', [{ cid: BOB, username: 'bob0924' }], { audio: true, video: false, screen: false }, DIRECT_CALL, null);
    await manager.handleSignal(BOB, 'bob0924', { kind: 'CallDecline', call_id: callId(), reason: 'rejected' });
    await manager.handleSignal(BOB, 'bob0924', { kind: 'CallEnd', call_id: callId(), reason: 'hangup' });

    expect(told(manager.getState())).toBe('bob0924 declined the call.');
  });

  it('is not overwritten by a local hang-up of the call that is already over', async () => {
    const { manager, callId } = caller();
    await manager.start('c1', [{ cid: BOB, username: 'bob0924' }], { audio: true, video: false, screen: false }, DIRECT_CALL, null);
    await manager.handleSignal(BOB, 'bob0924', { kind: 'CallDecline', call_id: callId(), reason: 'rejected' });
    await manager.end('hangup');

    expect(manager.getState()?.reason).toBe('rejected');
  });
});
