/**
 * One account in two tabs, one call: the tab not answered in stands down.
 *
 * Both tabs hold the called session, so both receive the invite and ring
 * (route-by-cid.ts delivers to every tab of the account). When the user
 * answered in one, the other went on ringing, and its ring deadline then sent
 * CallEnd('unanswered') to the caller -- ending the call just answered.
 *
 * Real: the CallManager and its reducer, deadline and signal handling, the
 * event bus and the hook. Mocked: the call transport (the socket) and the
 * instance channel (a BroadcastChannel), the two I/O boundaries.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const channelSend: ReturnType<typeof vi.fn> = vi.hoisted(() => vi.fn());
vi.mock('@/lib/multi-instance', () => ({ instanceChannel: { send: channelSend } }));

import { eventEmitter } from '@/lib/event-emitter';
import { CallManager, MEDIA_WIRE_VERSION } from '@/lib/call/call-manager';
import { CALL_TAKEN, standsDown, type CallTaken } from '@/lib/call/call-taken-elsewhere';
import { useCallTakenElsewhere } from '../use-call-taken-elsewhere';
import type { CallTransport } from '@/lib/call/call-transport';
import type { CallState } from '@/lib/call/call-state';

const SELF: bigint = 1n;
const CALLER: bigint = 7n;

function ringingTab(): { manager: CallManager; sendSignal: ReturnType<typeof vi.fn>; fireTimers: () => void } {
  const sendSignal: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(undefined);
  const timers: Array<() => void> = [];
  const transport: CallTransport = {
    openSession: vi.fn().mockResolvedValue(undefined),
    closeSession: vi.fn().mockResolvedValue(undefined),
    sendFrame: vi.fn(),
    sendSignal,
  };
  const manager: CallManager = new CallManager({
    transport, selfCid: SELF, capabilities: { audio: ['opus'], video: [] },
    now: () => 0,
    schedule: (fn) => { timers.push(fn); return (): void => { const i: number = timers.indexOf(fn); if (i >= 0) timers.splice(i, 1); }; },
    onStateChanged: () => undefined,
    resolvePeerName: (cid: bigint) => `peer-${cid}`,
    onKeyframeRequested: () => undefined,
  });
  return { manager, sendSignal, fireTimers: (): void => { for (const fn of [...timers]) fn(); } };
}

async function ring(manager: CallManager): Promise<void> {
  await manager.handleSignal(CALLER, 'bob', {
    kind: 'CallInvite', call_id: 'c1', media: { audio: true, video: false, screen: false },
    codecs: { audio: ['opus'], video: [] }, media_wire_version: MEDIA_WIRE_VERSION,
  });
}

function taken(answered: boolean): CallTaken {
  return { cid: SELF, callId: 'c1', answered };
}

beforeEach(() => channelSend.mockReset());

describe('a tab of the same account', () => {
  it('stops ringing when another tab answers, and says nothing to the caller', async () => {
    const tab: ReturnType<typeof ringingTab> = ringingTab();
    await ring(tab.manager);
    renderHook(() => useCallTakenElsewhere(SELF, { current: tab.manager }));

    await act(async () => { eventEmitter.emit(CALL_TAKEN, taken(true)); });
    expect(tab.manager.getState()?.status).toBe('ended');

    // The ring deadline was this tab's way of ending a call nobody answered.
    tab.fireTimers();
    expect(tab.sendSignal, 'the caller hears nothing from the tab that did not answer').not.toHaveBeenCalled();
  });

  it('tells the other tabs when it answers or declines', () => {
    const tab: ReturnType<typeof ringingTab> = ringingTab();
    const { result } = renderHook(() => useCallTakenElsewhere(SELF, { current: tab.manager }));
    result.current('c1', true);
    expect(channelSend).toHaveBeenCalledWith({ type: CALL_TAKEN, targetInstanceId: '*', payload: taken(true) });
  });
});

describe('standing down', () => {
  const ringingIn: CallState = { callId: 'c1', status: 'ringing-in' } as CallState;

  it('is for a ringing call of this session only', () => {
    expect(standsDown(taken(true), SELF, ringingIn)).toBe(true);
    expect(standsDown({ ...taken(true), cid: 2n }, SELF, ringingIn)).toBe(false);
    expect(standsDown({ ...taken(true), callId: 'other' }, SELF, ringingIn)).toBe(false);
    // A call this tab answered is its own; another tab's word cannot end it.
    expect(standsDown(taken(true), SELF, { ...ringingIn, status: 'active' })).toBe(false);
  });
});
