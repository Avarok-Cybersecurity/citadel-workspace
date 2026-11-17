/**
 * Interest lives on the agent, per connection. A request sent before the
 * session was claimed on a new connection is refused, and one sent before an
 * agent restart is forgotten: either way the chat waited out the renewal
 * timer (30 s) with nobody dialling its peer. A claim of the chat's own
 * session is the moment to say it again.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { FakeAgent } from './fake-supervising-agent';
import { useChatInterest } from '@/components/p2p/hooks/use-chat-interest';
import { forgetCapabilities, registerCapabilityRoute } from '@/lib/agent-conversations/capabilities';
import { eventEmitter } from '@/lib/event-emitter';
import { SESSION_CLAIMED, type ClaimedEvent } from '@/lib/multi-instance/claim-relay';

const OURS: bigint = 100n;
const PEER: bigint = 200n;
const agent: FakeAgent = new FakeAgent();
const flush: () => Promise<void> = async (): Promise<void> => { for (let i: number = 0; i < 10; i += 1) await Promise.resolve(); };

beforeEach((): void => {
  agent.sent.length = 0;
  registerCapabilityRoute({ isLeader: () => true, askLeader: async () => { throw new Error('the leader does not ask itself'); } });
  vi.useFakeTimers();
});
afterEach((): void => { vi.useRealTimers(); forgetCapabilities(); });

describe('an open chat', () => {
  it('says its peer is wanted again when its own session is claimed', async (): Promise<void> => {
    await agent.greet('supervising');
    renderHook(() => useChatInterest(OURS, PEER));
    await flush();
    expect(agent.interests()).toHaveLength(1);
    eventEmitter.emit<ClaimedEvent>(SESSION_CLAIMED, { cid: OURS });
    await flush();
    expect(agent.interests()).toHaveLength(2);
  });

  it('ignores the claim of another session', async (): Promise<void> => {
    await agent.greet('supervising');
    renderHook(() => useChatInterest(OURS, PEER));
    await flush();
    eventEmitter.emit<ClaimedEvent>(SESSION_CLAIMED, { cid: 999n });
    await flush();
    expect(agent.interests()).toHaveLength(1);
  });

  it('stops listening when closed', async (): Promise<void> => {
    await agent.greet('supervising');
    const { unmount } = renderHook(() => useChatInterest(OURS, PEER));
    await flush();
    unmount();
    eventEmitter.emit<ClaimedEvent>(SESSION_CLAIMED, { cid: OURS });
    await flush();
    expect(agent.interests()).toHaveLength(1);
  });
});
