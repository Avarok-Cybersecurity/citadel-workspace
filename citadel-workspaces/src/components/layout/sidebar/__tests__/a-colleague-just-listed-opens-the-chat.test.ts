/**
 * Clicking a colleague the agent has only just listed opens the chat.
 *
 * The peer listing is polled every 30s. A newcomer the agent already lists was
 * missing from it until the next round, and clicking their row said they were
 * unreachable meanwhile. The click now asks for a fresh round once before
 * saying so. The listing and its refresh are passed in, so these are fakes, not
 * mocks of a module.
 */
import { describe, it, expect } from 'vitest';
import { resolveMemberChat, type MemberChatTarget } from '../member-chat-target';

interface FakeListing {
  lookup: (username: string) => bigint | undefined;
  refresh: () => Promise<void>;
  refreshes: () => number;
}

function listing(initial: Record<string, bigint>, afterRefresh: Record<string, bigint>): FakeListing {
  let current: Record<string, bigint> = initial;
  let count: number = 0;
  return {
    lookup: (username: string): bigint | undefined => current[username],
    refresh: async (): Promise<void> => { count += 1; current = afterRefresh; },
    refreshes: (): number => count,
  };
}

describe('opening a colleague from the member list', () => {
  it('asks the listing again when it does not have them yet', async () => {
    const agent: FakeListing = listing({}, { bob: 42n });
    const target: MemberChatTarget = await resolveMemberChat('bob', 'alice', [], agent.lookup, agent.refresh);
    expect(target).toEqual({ kind: 'conversation', cid: 42n });
    expect(agent.refreshes()).toBe(1);
  });

  it('does not ask when the listing already has them', async () => {
    const agent: FakeListing = listing({ bob: 42n }, {});
    expect(await resolveMemberChat('bob', 'alice', [], agent.lookup, agent.refresh)).toEqual({ kind: 'conversation', cid: 42n });
    expect(agent.refreshes()).toBe(0);
  });

  it('still says unreachable when the fresh round does not have them either', async () => {
    const agent: FakeListing = listing({}, {});
    expect(await resolveMemberChat('bob', 'alice', [], agent.lookup, agent.refresh)).toEqual({ kind: 'unreachable' });
    expect(agent.refreshes()).toBe(1);
  });

  it('opens nothing, and asks nothing, for your own row', async () => {
    const agent: FakeListing = listing({}, { alice: 7n });
    expect(await resolveMemberChat('alice', 'alice', [], agent.lookup, agent.refresh)).toBeNull();
    expect(agent.refreshes()).toBe(0);
  });
});
