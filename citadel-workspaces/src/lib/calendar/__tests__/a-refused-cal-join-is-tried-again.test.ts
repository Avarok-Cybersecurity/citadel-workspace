/**
 * A `cal` join the host refuses (nobody admitted this member within the port bound) is said and
 * tried again every CAL_JOIN_RETRY_MS while the window listens; leaving stops the tries.
 *
 * TEST FAKE: the Calendar's topic port is an in-memory CalendarTopics, the boundary cal-topic.ts
 * is given; it refuses the first `refusals` opens as the host does. listenCal is production.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CAL_JOIN_RETRY_MS, CAL_TOPIC, listenCal } from '../cal-topic';
import { PortRefused, type CalendarPorts } from '../ports';
import { realEngine } from './engine-rig';

function topics(refusals: number): { readonly ports: Pick<CalendarPorts, 'topics'>; readonly opens: () => number } {
  let opens: number = 0;
  const ports: Pick<CalendarPorts, 'topics'> = {
    topics: {
      open: async (name: string): Promise<readonly string[]> => {
        expect(name).toBe(CAL_TOPIC);
        opens += 1;
        if (opens <= refusals) throw new PortRefused('TopicOpen', { unavailable: 'topic' });
        return [];
      },
      publish: async (): Promise<void> => undefined,
      close: async (): Promise<void> => undefined,
      onArrival: () => (): void => undefined,
    },
  };
  return { ports, opens: () => opens };
}

describe('a refused cal join', () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('is said and tried again after the retry interval, until it is in', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const t = topics(2);
    listenCal(t.ports, realEngine(), () => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect([t.opens(), warn.mock.calls[0]?.[0]]).toEqual([1, '[calendar] the cal topic could not be joined; changes arrive by storage only; trying again in 10 s']);
    await vi.advanceTimersByTimeAsync(CAL_JOIN_RETRY_MS - 1);
    expect(t.opens()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.opens()).toBe(2);
    await vi.advanceTimersByTimeAsync(CAL_JOIN_RETRY_MS);
    expect(t.opens()).toBe(3);
    await vi.advanceTimersByTimeAsync(CAL_JOIN_RETRY_MS * 3);
    expect([t.opens(), warn.mock.calls.length]).toEqual([3, 2]);
  });

  it('stops trying once the window leaves', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const t = topics(Infinity);
    const leave: () => void = listenCal(t.ports, realEngine(), () => undefined);
    await vi.advanceTimersByTimeAsync(0);
    leave();
    await vi.advanceTimersByTimeAsync(CAL_JOIN_RETRY_MS * 3);
    expect(t.opens()).toBe(1);
  });
});
