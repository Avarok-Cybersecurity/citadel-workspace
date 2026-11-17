/**
 * Calling works in whichever tab the user is looking at.
 *
 * One browser has one WebSocket, held by an elected leader tab, and calling
 * used to be switched off everywhere else: the buttons were disabled with
 * "Calls run in whichever Citadel tab you opened first", and an incoming call
 * rang nowhere at all -- the invite is addressed to the session, so it reached
 * the follower tab that owns that session, which refused to ring because it
 * was not the leader, while the leader never heard it.
 *
 * The call now lives in the tab whose session is in it, and only the frames and
 * session requests cross to the leader (media-frame-relay.ts). Mocked: the
 * instance manager (it needs a live BroadcastChannel to answer) and the heavy
 * call machinery the provider builds lazily.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, renderHook, screen, act, cleanup, type RenderResult } from '@testing-library/react';

const state: { isLeader: boolean } = vi.hoisted(() => ({ isLeader: false }));
vi.mock('@/lib/multi-instance', () => ({
  instanceManager: {
    get isLeader(): boolean {
      return state.isLeader;
    },
  },
}));
vi.mock('@/lib/call/codec-support', () => ({
  probeMediaCapabilities: (): Promise<{ supported: boolean; }> => Promise.resolve({ supported: true }),
  localCapabilities: (): Promise<{}> => Promise.resolve({}),
}));
vi.mock('@/lib/call/call-manager', () => ({ CallManager: class {} }));
vi.mock('@/lib/call/websocket-call-transport', () => ({ WebSocketCallTransport: class {} }));
vi.mock('@/lib/roster-peer-name', () => ({ rosterPeerName: (): string => 'Peer' }));

import { CallProvider } from '../CallProvider';
import { RingingCall } from '../RingingCall';
import { CallContext, useCall, type CallContextValue } from '@/lib/call/call-context';
import type { CallState } from '@/lib/call/call-state';

function CapabilityProbe(): JSX.Element {
  const { capability } = useCall();
  return <span data-testid="reason">{capability.supported ? 'available' : capability.reason}</span>;
}

function renderProvider(): RenderResult {
  return render(
    <CallProvider selfCid={11n} senderConfig={{} as never}>
      <CapabilityProbe />
    </CallProvider>,
  );
}

const ringingIn: CallState = {
  callId: 'c1', status: 'ringing-in', home: { kind: 'direct' }, outgoing: false, caller: 7n,
  selfMedia: { audio: true, video: false }, selfSpeaking: false, reason: null,
  participants: new Map([[7n, { cid: 7n, username: 'bob', status: 'invited', media: { audio: true, video: false }, speaking: false }]]),
} as CallState;

beforeEach(() => {
  cleanup();
  state.isLeader = false;
});

describe('a tab that does not hold the WebSocket', () => {
  it('offers calling', async () => {
    renderProvider();
    await act(async () => {});
    expect(screen.getByTestId('reason')).toHaveTextContent('available');
  });

  it('rings for a call to its own session', () => {
    const defaults: CallContextValue = renderHook((): CallContextValue => useCall()).result.current;
    render(
      <CallContext.Provider value={{ ...defaults, call: ringingIn }}>
        <RingingCall />
      </CallContext.Provider>,
    );
    expect(screen.getByTestId('incoming-call-card')).toBeInTheDocument();
  });
});

describe('the tab that holds the WebSocket', () => {
  it('offers calling too', async () => {
    state.isLeader = true;
    renderProvider();
    await act(async () => {});
    expect(screen.getByTestId('reason')).toHaveTextContent('available');
  });
});
