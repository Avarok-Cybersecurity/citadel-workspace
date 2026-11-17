/**
 * With strangers refused, a direct message from someone who is not a contact
 * is not shown.
 *
 * The protocol already makes this rare -- a P2P channel needs a mutual
 * registration, and the registration is where strangers are refused
 * (incoming-request-policy.ts) -- so this is the second line. What it must
 * never do is hide a CONTACT's message because this tab's copy of the contact
 * list lagged: the agent is asked before anything is dropped, and a failed ask
 * shows the message rather than losing it.
 */
import { describe, it, expect } from 'vitest';
import { isHiddenAsStranger, type StrangerGateDeps } from '../stranger-message-gate';

function deps(overrides: Partial<StrangerGateDeps>): StrangerGateDeps & { asked: bigint[] } {
  const asked: bigint[] = [];
  return {
    asked,
    acceptsRequestsFromStrangers: (): boolean => false,
    isKnownContact: (): boolean => false,
    agentSaysRegistered: async (peer: bigint): Promise<boolean | null> => { asked.push(peer); return false; },
    ...overrides,
  };
}

describe('a message from a peer this tab does not know', () => {
  it('is hidden when strangers are refused and the agent confirms they are not a contact', async () => {
    expect(await isHiddenAsStranger(42n, deps({}))).toBe(true);
  });

  it('is shown when strangers are accepted, without asking anyone', async () => {
    const d: StrangerGateDeps & { asked: bigint[] } = deps({ acceptsRequestsFromStrangers: () => true });
    expect(await isHiddenAsStranger(42n, d)).toBe(false);
    expect(d.asked).toEqual([]);
  });

  it('is shown when the agent says they ARE registered (this tab was behind)', async () => {
    expect(await isHiddenAsStranger(42n, deps({ agentSaysRegistered: async () => true }))).toBe(false);
  });

  it('is shown when the agent cannot be asked, rather than lost', async () => {
    expect(await isHiddenAsStranger(42n, deps({ agentSaysRegistered: async () => null }))).toBe(false);
  });
});

describe('a message from a known contact', () => {
  it('is shown without asking the agent', async () => {
    const d: StrangerGateDeps & { asked: bigint[] } = deps({ isKnownContact: () => true });
    expect(await isHiddenAsStranger(42n, d)).toBe(false);
    expect(d.asked).toEqual([]);
  });
});
