/**
 * A call rings in the tab whose session is called. When that tab is in the
 * background the card is unseen, so it says so where the user can see it: its
 * own title in the tab strip, and a notice in a Citadel tab that is in front.
 *
 * Mocked: the instance channel (a BroadcastChannel) and the roster lookup.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';

const channelSend: ReturnType<typeof vi.fn> = vi.hoisted(() => vi.fn());
vi.mock('@/lib/multi-instance', () => ({ instanceChannel: { send: channelSend } }));
vi.mock('@/lib/roster-peer-name', () => ({ rosterPeerName: (): string => 'Bob' }));
const toastSpy: { show: ReturnType<typeof vi.fn>; dismiss: ReturnType<typeof vi.fn> } = vi.hoisted(() => ({ show: vi.fn(), dismiss: vi.fn() }));
vi.mock('sonner', () => ({ toast: Object.assign(toastSpy.show, { dismiss: toastSpy.dismiss }) }));

import { eventEmitter } from '@/lib/event-emitter';
import { useRingingHandOff } from '../use-ringing-hand-off';
import { RINGING_ELSEWHERE, handOffNotice, type RingingElsewhere } from '@/lib/call/ringing-hand-off';
import type { CallState } from '@/lib/call/call-state';

const ringingIn: CallState = {
  callId: 'c1', status: 'ringing-in', home: { kind: 'direct' }, outgoing: false, caller: 7n,
  selfMedia: { audio: true, video: false }, selfSpeaking: false, reason: null,
  participants: new Map([[7n, { cid: 7n, username: 'bob', status: 'invited', media: { audio: true, video: false }, speaking: false }]]),
} as CallState;

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
}

beforeEach(() => {
  cleanup();
  channelSend.mockReset();
  toastSpy.show.mockReset();
  toastSpy.dismiss.mockReset();
  document.title = 'Citadel';
});

describe('the tab a call is ringing in', () => {
  it('puts the call in its title and tells the other tabs while it is hidden', () => {
    setVisibility('hidden');
    const { rerender } = renderHook(({ call }: { call: CallState | null }) => useRingingHandOff(11n, call), {
      initialProps: { call: ringingIn as CallState | null },
    });
    expect(document.title).toBe('Incoming call · Bob');
    expect(channelSend).toHaveBeenLastCalledWith({
      type: RINGING_ELSEWHERE, targetInstanceId: '*',
      payload: { cid: 11n, callId: 'c1', callerName: 'Bob', ringing: true },
    });

    // Answered, declined or gone: the title is its own again, the notice withdrawn.
    rerender({ call: null });
    expect(document.title).toBe('Citadel');
    expect(channelSend).toHaveBeenLastCalledWith(expect.objectContaining({ payload: expect.objectContaining({ ringing: false }) }));
  });

  it('keeps its own title while the user is looking at it', () => {
    setVisibility('visible');
    renderHook(() => useRingingHandOff(11n, ringingIn));
    expect(document.title).toBe('Citadel');
  });
});

describe('a tab in front, for another session', () => {
  const event: RingingElsewhere = { cid: 11n, callId: 'c1', callerName: 'Bob', ringing: true };

  it('shows where to answer, and withdraws it when the ringing stops', () => {
    setVisibility('visible');
    renderHook(() => useRingingHandOff(22n, null));
    act(() => { eventEmitter.emit(RINGING_ELSEWHERE, event); });
    expect(toastSpy.show).toHaveBeenCalledWith(expect.stringContaining('Bob is calling you in another Citadel tab'), expect.objectContaining({ duration: Infinity }));
    act(() => { eventEmitter.emit(RINGING_ELSEWHERE, { ...event, ringing: false }); });
    expect(toastSpy.dismiss).toHaveBeenCalledWith('call-ringing-elsewhere-c1');
  });

  it('shows it when the tab comes to the front while the call is still ringing', () => {
    // The notice was posted while this tab was in the background too; what it
    // shows on coming forward is the current state, not only the next event.
    setVisibility('hidden');
    renderHook(() => useRingingHandOff(22n, null));
    act(() => { eventEmitter.emit(RINGING_ELSEWHERE, event); });
    expect(toastSpy.show).not.toHaveBeenCalled();

    setVisibility('visible');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(toastSpy.show).toHaveBeenCalledTimes(1);

    // Ringing over before it came forward: nothing to show.
    toastSpy.show.mockReset();
    setVisibility('hidden');
    act(() => { eventEmitter.emit(RINGING_ELSEWHERE, { ...event, ringing: false }); });
    setVisibility('visible');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(toastSpy.show).not.toHaveBeenCalled();
  });

  it('is silent for a tab of the same session, which rings by itself', () => {
    expect(handOffNotice(event, 11n, true)).toEqual({ kind: 'none' });
    expect(handOffNotice(event, 22n, false)).toEqual({ kind: 'none' });
  });
});
