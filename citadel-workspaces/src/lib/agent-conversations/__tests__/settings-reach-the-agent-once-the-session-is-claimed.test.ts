/**
 * Live, 2026-10-16: every reload logged "could not tell the agent this account's settings: Session
 * unavailable to this connection". The push went out when the cached conversations loaded, before
 * the connection claimed the session, and nothing said it again -- the agent kept stale settings
 * until the user next saved them.
 */
import { describe, it, expect } from 'vitest';
import { createPreferencesTeller, OWNERSHIP_REFUSAL, type PreferencesTeller } from '../tell-preferences';

const OWN: bigint = 9_007_199_254_740_993n;

interface Harness { teller: PreferencesTeller; pushes: bigint[]; deferred: bigint[]; attached: { value: boolean } }

/** An agent that refuses this connection until it carries the session, as the agent's ownership gate does. */
function harness(): Harness {
  const pushes: bigint[] = [];
  const deferred: bigint[] = [];
  const attached: { value: boolean } = { value: false };
  const teller: PreferencesTeller = createPreferencesTeller({
    hosts: async (): Promise<boolean> => true,
    ownCid: async (): Promise<bigint | null> => OWN,
    push: async (cid: bigint): Promise<void> => {
      if (!attached.value) throw new Error(OWNERSHIP_REFUSAL);
      pushes.push(cid);
    },
    deferred: (cid: bigint): void => { deferred.push(cid); },
  });
  return { teller, pushes, deferred, attached };
}

describe("the account's settings", () => {
  it('refused before the claim, are not an error, and reach the agent once the session is claimed', async () => {
    const h: Harness = harness();
    await expect(h.teller.changed()).resolves.toBeUndefined();
    expect(h.deferred).toEqual([OWN]);
    expect(h.pushes).toEqual([]);

    h.attached.value = true;
    await h.teller.claimed(OWN);
    expect(h.pushes).toEqual([OWN]);
  });

  it("a claim of another account's session says nothing for this one", async () => {
    const h: Harness = harness();
    h.attached.value = true;
    await h.teller.claimed(OWN + 1n);
    expect(h.pushes).toEqual([]);
  });

  it('refused after the claim, is a failure the caller hears', async () => {
    const h: Harness = harness();
    h.attached.value = true;
    await h.teller.claimed(OWN);
    h.attached.value = false;
    await expect(h.teller.changed()).rejects.toThrow(OWNERSHIP_REFUSAL);
  });

  it('any other failure before the claim is still a failure', async () => {
    const teller: PreferencesTeller = createPreferencesTeller({
      hosts: async (): Promise<boolean> => true,
      ownCid: async (): Promise<bigint | null> => OWN,
      push: async (): Promise<void> => { throw new Error('GetPreferences request timed out'); },
      deferred: (): void => { throw new Error('a timeout is not a refusal'); },
    });
    await expect(teller.changed()).rejects.toThrow('timed out');
  });
});
