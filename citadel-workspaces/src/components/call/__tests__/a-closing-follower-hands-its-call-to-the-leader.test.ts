/**
 * pagehide in the tab a call lives in. A follower posts the hand-over to the
 * leader -- synchronously, which is all a closing document is sure to finish.
 * The hook runs as a departure step, which the channel's own pagehide handler
 * runs ahead of its session release (departure-steps.ts), so the test departs
 * the way that handler does. Mocked: the instance channel and election (a
 * BroadcastChannel).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const tab: { isLeader: boolean } = vi.hoisted(() => ({ isLeader: false }));
const channelSend: ReturnType<typeof vi.fn> = vi.hoisted(() => vi.fn());
vi.mock('@/lib/multi-instance', () => ({
  instanceChannel: { send: channelSend },
  instanceManager: { get isLeader(): boolean { return tab.isLeader; } },
}));
vi.mock('@/lib/call/websocket-call-transport', () => ({ WebSocketCallTransport: class {} }));

import { useCallDeparture } from '../use-call-departure';
import { CALL_DEPARTED } from '@/lib/call/call-departure';
import { runDepartureSteps } from '@/lib/multi-instance/departure-steps';
import type { CallManager } from '@/lib/call/call-manager';
import type { CallState } from '@/lib/call/call-state';
import type { MessageSenderConfig } from '@/lib/p2p/message-sender-types';

const active: CallState = { callId: 'c1', status: 'active', participants: new Map([[7n, {}]]) } as unknown as CallState;

function manager(): CallManager & { end: ReturnType<typeof vi.fn> } {
  return { getState: (): CallState => active, end: vi.fn().mockResolvedValue(undefined) } as unknown as CallManager & { end: ReturnType<typeof vi.fn> };
}

beforeEach(() => channelSend.mockReset());

describe('a tab closing mid-call', () => {
  it('as a follower, hands the call to the leader', () => {
    tab.isLeader = false;
    const m: ReturnType<typeof manager> = manager();
    renderHook(() => useCallDeparture(11n, {} as MessageSenderConfig, { current: m }));
    runDepartureSteps((error: unknown): void => { throw error; });
    expect(channelSend).toHaveBeenCalledWith({
      type: CALL_DEPARTED, targetInstanceId: 'leader', payload: { cid: 11n, callId: 'c1', peers: [7n] },
    });
    expect(m.end).not.toHaveBeenCalled();
  });

  it('as the leader, hangs up itself, having nobody to hand to', () => {
    tab.isLeader = true;
    const m: ReturnType<typeof manager> = manager();
    renderHook(() => useCallDeparture(11n, {} as MessageSenderConfig, { current: m }));
    runDepartureSteps((error: unknown): void => { throw error; });
    expect(m.end).toHaveBeenCalledWith('hangup');
    expect(channelSend).not.toHaveBeenCalled();
  });
});
