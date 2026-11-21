/**
 * Exactly one retention sweeper, and it is the agent's: it sweeps every
 * conversation itself, so a window prunes nothing. A window's only part is to
 * tell the agent the periods when one changes, and to report what went.
 */
import { describe, it, expect } from 'vitest';
import { createRetention, type RetentionRunner } from '../retention-runner';

const OWN: bigint = 1n;
const BOB: bigint = 2n;

function agent(removedOnTell: number, own: bigint | null = OWN): { told: bigint[]; runner: RetentionRunner } {
  const told: bigint[] = [];
  let held: number = 5;
  const runner: RetentionRunner = createRetention({
    currentCid: async (): Promise<bigint | null> => own,
    tell: async (cid: bigint): Promise<void> => { told.push(cid); held -= removedOnTell; },
    count: async (): Promise<number> => held,
  });
  return { told, runner };
}

describe('retention the agent keeps', () => {
  it('tells the agent when a period changes, and reports what its sweep removed', async () => {
    const { told, runner } = agent(3);
    expect(await runner.retentionChanged(BOB)).toBe(3);
    expect(told).toEqual([OWN]);
  });

  it('tells nobody without a session', async () => {
    const { told, runner } = agent(3, null);
    expect(await runner.retentionChanged(BOB)).toBe(0);
    expect(told).toEqual([]);
  });
});
