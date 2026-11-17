/**
 * A glue instance paces its server calls with a bucket of its own before the Dispatcher's bucket
 * gates them. The two are in series, so what reaches a port is bounded by one bucket of the
 * policy's rate: at most `rate` at once and `rate` a second after, whatever the burst. Two buckets
 * in parallel (either one admitting) would let `2 × rate` through at once, which this refuses.
 */
import { describe, expect, it } from 'vitest';
import type { Capability } from '../capabilities';
import { glueInstance, type GlueInstance } from '../glue-instance';
import { STANDARD_HOST_POLICY } from '../limits';
import type { HostReply } from '../ports';
import { fakeStorage, ManualClock, type Recorder } from './fakes';

const flush = (): Promise<void> => new Promise<void>((done: () => void): void => { setTimeout(done, 0); });
const RATE: number = STANDARD_HOST_POLICY.serverCallsPerSecond;
const STEP_MS: number = 10;

/** Cumulative calls that reached the port, sampled every STEP_MS from the burst until all landed. */
async function arrivals(burst: number): Promise<{ readonly counts: number[]; readonly answers: HostReply<unknown>[] }> {
  const rec: Recorder = { calls: [] };
  const clock: ManualClock = new ManualClock();
  const g: GlueInstance = glueInstance({
    appId: 'net.avarok.calendar', ports: { storage: fakeStorage(rec) }, held: new Set<Capability>(['storage.user']),
    policy: STANDARD_HOST_POLICY, limits: { topics: null, p2p: null }, clock, pageUrl: 'https://w.example/n1', storageChanges: () => () => {},
  });
  const pending: Promise<HostReply<unknown>>[] = Array.from({ length: burst }, () => g.op('KvGet', { backend: 'user', key: 'k' }));
  const counts: number[] = [];
  const horizon: number = Math.ceil((burst / RATE) * 1000) + 1000;
  for (let t: number = 0; t <= horizon; t += STEP_MS) {
    await flush();
    counts.push(rec.calls.length);
    clock.advance(STEP_MS);
  }
  const answers: HostReply<unknown>[] = await Promise.all(pending);
  g.close();
  return { counts, answers };
}

/** The most one bucket of RATE, full at the start, can admit by time t (ms). */
const envelope = (t: number): number => RATE + Math.floor((t * RATE) / 1000);

describe("a glue app's server calls", () => {
  it('never reach the port faster than one bucket of the policy rate, for any burst', async () => {
    for (const burst of [RATE, 2 * RATE, 5 * RATE + 3]) {
      const { counts } = await arrivals(burst);
      counts.forEach((n: number, i: number) => expect(n, `burst ${burst} at ${i * STEP_MS} ms`).toBeLessThanOrEqual(envelope(i * STEP_MS)));
      expect(counts[0]).toBe(Math.min(burst, RATE));
      expect(counts[counts.length - 1]).toBe(burst);
    }
  });

  it('admit no more than one bucket allows in any one-second window (a full bucket plus a second of refill)', async () => {
    const { counts } = await arrivals(5 * RATE);
    const since: number[] = [0, ...counts];
    const window: number = 1000 / STEP_MS;
    for (let i: number = 0; i + window < since.length; i += 1) {
      expect(since[i + window] - since[i], `window from ${(i - 1) * STEP_MS} ms`).toBeLessThanOrEqual(2 * RATE);
    }
  });

  it('wait rather than being refused by the gate they are paced for', async () => {
    const { answers } = await arrivals(3 * RATE);
    expect(answers.filter((a: HostReply<unknown>) => 'refused' in a)).toEqual([]);
  });
});
