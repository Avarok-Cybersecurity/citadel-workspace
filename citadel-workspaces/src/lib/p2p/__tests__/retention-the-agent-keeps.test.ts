/**
 * Exactly one retention sweeper. When the agent hosts the account (0.8.6) it
 * sweeps every conversation itself, so a window must prune nothing: two
 * sweepers over one store would race each other's page writes. A window's only
 * part is to tell the agent the periods, when one changes.
 */
import { describe, it, expect } from 'vitest';
import { createRetention, type RetentionRunner } from '../retention-runner';
import { rig, count, OWN, BOB, CAROL, type Rig } from './retention-rig';

function hosted(r: Rig, removedOnTell: number): { told: bigint[]; runner: RetentionRunner } {
  const told: bigint[] = [];
  let held: number = 5;
  r.deps.agent = {
    hosts: async (): Promise<boolean> => true,
    tell: async (own: bigint): Promise<void> => { told.push(own); held -= removedOnTell; },
    count: async (): Promise<number> => held,
  };
  return { told, runner: createRetention(r.deps) };
}

describe('retention when the agent keeps the store', () => {
  it('prunes nothing on open, on boot or on a tick', async () => {
    const r: Rig = rig();
    await r.store.set(OWN, BOB, { retention: 7 });
    await r.store.set(OWN, CAROL, { retention: 7 });
    const { told, runner } = hosted(r, 0);

    expect(await runner.applyRetention(BOB)).toBe(0);
    await runner.sweepNow();
    runner.start(60_000);
    await runner.tick();

    expect([count(r, BOB), count(r, CAROL)]).toEqual([2, 2]);
    expect(r.expired).toEqual([]);
    expect(told).toEqual([]);
  });

  it('tells the agent when a period changes, and reports what its sweep removed', async () => {
    const r: Rig = rig();
    await r.store.set(OWN, BOB, { retention: 7 });
    const { told, runner } = hosted(r, 3);

    expect(await runner.retentionChanged(BOB)).toBe(3);
    expect(told).toEqual([OWN]);
    expect(count(r, BOB)).toBe(2);
  });

  it('prunes here, as before, for an agent that does not host the account', async () => {
    const r: Rig = rig();
    await r.store.set(OWN, BOB, { retention: 7 });
    expect(await createRetention(r.deps).retentionChanged(BOB)).toBe(1);
    expect(count(r, BOB)).toBe(1);
  });
});
