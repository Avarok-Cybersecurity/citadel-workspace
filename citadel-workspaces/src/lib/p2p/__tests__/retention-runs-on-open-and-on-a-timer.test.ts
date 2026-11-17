/**
 * Retention is applied to a chat when it is opened, and to every chat of this
 * account on a timer -- each with its own period, and never to a chat that
 * keeps everything.
 *
 * The deps stand in for the agent's LocalDB (via `RetentionPageIO`), the clock
 * and the timer; the settings store is real, over an in-memory port.
 */
import { describe, it, expect } from 'vitest';
import { createRetention } from '../retention-runner';
import { rig, count, OWN, BOB, CAROL, DAY, NOW, type Rig } from './retention-rig';

describe('applying retention', () => {
  it('prunes one chat by its own period and tells the open view', async () => {
    const r: Rig = rig();
    await r.store.set(OWN, BOB, { retention: 7 });
    expect(await createRetention(r.deps).applyRetention(BOB)).toBe(1);
    expect(count(r, BOB)).toBe(1);
    expect(r.expired).toEqual([[BOB, NOW - 7 * DAY]]);
  });

  it('leaves a chat that keeps everything untouched', async () => {
    const r: Rig = rig();
    expect(await createRetention(r.deps).applyRetention(CAROL)).toBe(0);
    expect(count(r, CAROL)).toBe(2);
    expect(r.expired).toEqual([]);
  });

  it('sweeps every chat when started, and again on each tick', async () => {
    const r: Rig = rig();
    await r.store.set(OWN, BOB, { retention: 30 });
    await r.store.set(OWN, CAROL, { retention: 7 });
    const retention: ReturnType<typeof createRetention> = createRetention(r.deps);

    await retention.sweepNow();
    expect([count(r, BOB), count(r, CAROL)]).toEqual([2, 1]);

    // Bob's period shortens; the next tick applies it without anyone opening the chat.
    await r.store.set(OWN, BOB, { retention: 1 });
    retention.start(60_000);
    expect(r.timers).toHaveLength(1);
    await retention.tick();
    expect(count(r, BOB)).toBe(1);
  });

  it('starts one timer however often it is started', () => {
    const r: Rig = rig();
    const retention: ReturnType<typeof createRetention> = createRetention(r.deps);
    retention.start(60_000);
    retention.start(60_000);
    expect(r.timers).toHaveLength(1);
  });
});
