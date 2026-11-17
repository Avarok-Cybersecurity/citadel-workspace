/**
 * An open chat, or a call, tells a supervising agent its peer is wanted, keeps
 * saying so while it lasts and stops when it ends. An agent that does not
 * supervise is sent nothing: it would refuse the unknown request.
 *
 * Real: the hooks, holdInterest, the capability read from the greeting, the
 * request builder. Stood in: the websocket send (FakeAgent records it), which is
 * the WebSocket to the agent, and the clock (fake timers, to cross a renewal).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { FakeAgent } from './fake-supervising-agent';
import { useChatInterest } from '@/components/p2p/hooks/use-chat-interest';
import { useCallInterest } from '@/components/call/use-call-interest';
import { INTEREST_LIFETIME_MS } from '../interest';
import { forgetCapabilities, registerCapabilityRoute } from '@/lib/agent-conversations/capabilities';
import type { CallState } from '@/lib/call/call-state';

const OURS: bigint = 100n;
const PEER: bigint = 200n;
const agent: FakeAgent = new FakeAgent();

const flush: () => Promise<void> = async (): Promise<void> => { for (let i: number = 0; i < 10; i += 1) await Promise.resolve(); };

function callWith(status: CallState['status'], peers: bigint[]): CallState {
  const participants: CallState['participants'] = new Map(peers.map((cid: bigint) => [cid, { cid, username: `u${cid}`, status: 'connected' }])) as unknown as CallState['participants'];
  return { callId: 'c1', status, participants } as unknown as CallState;
}

beforeEach((): void => {
  agent.sent.length = 0; agent.silent = false;
  registerCapabilityRoute({ isLeader: () => true, askLeader: async () => { throw new Error('the leader does not ask itself'); } });
  vi.useFakeTimers();
});
afterEach((): void => { vi.useRealTimers(); forgetCapabilities(); });

describe('an open chat', () => {
  it('says its peer is wanted, renews that, and stops when closed', async (): Promise<void> => {
    await agent.greet('supervising');
    const { unmount } = renderHook(() => useChatInterest(OURS, PEER));
    await flush();
    expect(agent.interests().map((i) => i.peerCid)).toEqual([PEER]);

    await vi.advanceTimersByTimeAsync(INTEREST_LIFETIME_MS / 2);
    expect(agent.interests()).toHaveLength(2);
    // Each renewal reaches further than the last: an expiry the agent can act on.
    const [first, second] = agent.interests();
    expect(second.until).toBeGreaterThan(first.until);

    unmount();
    await vi.advanceTimersByTimeAsync(INTEREST_LIFETIME_MS * 3);
    expect(agent.interests()).toHaveLength(2);
  });

  it('sends nothing to an agent that does not supervise', async (): Promise<void> => {
    await agent.greet('older');
    renderHook(() => useChatInterest(OURS, PEER));
    await vi.advanceTimersByTimeAsync(INTEREST_LIFETIME_MS * 2);
    expect(agent.sent).toEqual([]);
  });

  it('sends nothing before there is a session and a peer', async (): Promise<void> => {
    await agent.greet('supervising');
    renderHook(() => useChatInterest(null, PEER));
    renderHook(() => useChatInterest(OURS, null));
    await vi.advanceTimersByTimeAsync(INTEREST_LIFETIME_MS * 2);
    expect(agent.sent).toEqual([]);
  });

  it('is not held up by an agent that never answers', async (): Promise<void> => {
    await agent.greet('supervising');
    agent.silent = true;
    renderHook(() => useChatInterest(OURS, PEER));
    await flush();
    expect(agent.interests()).toHaveLength(1);
  });
});

describe('a call', () => {
  it('holds interest in every other participant while it is on', async (): Promise<void> => {
    await agent.greet('supervising');
    const { rerender } = renderHook(({ call }: { call: CallState }) => useCallInterest(OURS, call), {
      initialProps: { call: callWith('active', [OURS, PEER, 300n]) },
    });
    await flush();
    expect(agent.interests().map((i) => i.peerCid).sort()).toEqual([PEER, 300n]);

    rerender({ call: callWith('ended', [OURS, PEER, 300n]) });
    const seen: number = agent.interests().length;
    await vi.advanceTimersByTimeAsync(INTEREST_LIFETIME_MS * 2);
    expect(agent.interests()).toHaveLength(seen);
  });

  it('sends nothing for a call that ended before the interest module loaded', async (): Promise<void> => {
    await agent.greet('supervising');
    const { unmount } = renderHook(() => useCallInterest(OURS, callWith('active', [OURS, PEER])));
    unmount();
    await vi.dynamicImportSettled();
    await vi.advanceTimersByTimeAsync(INTEREST_LIFETIME_MS * 2);
    expect(agent.interests()).toEqual([]);
  });

  it('sends nothing to an agent that does not supervise', async (): Promise<void> => {
    await agent.greet('older');
    renderHook(() => useCallInterest(OURS, callWith('active', [OURS, PEER])));
    await vi.advanceTimersByTimeAsync(INTEREST_LIFETIME_MS);
    expect(agent.sent).toEqual([]);
  });
});
