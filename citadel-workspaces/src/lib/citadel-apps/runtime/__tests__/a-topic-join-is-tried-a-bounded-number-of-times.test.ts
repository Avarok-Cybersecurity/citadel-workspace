/**
 * A topic join nobody admits is tried at most JOIN_ATTEMPTS times on the timer, then waits, naming
 * the owner, until Try again or a consent change, each worth one try (runtime/topic-rejoin.ts); a
 * join the host makes after the app's own open failed reaches the app as a `members` event.
 *
 * TEST FAKE: the inner topic port is an in-memory OwnedTopicPort answering each open from a script
 * (topic-port.ts and its agent are proven in their own tests); the timer is vitest's fake clock and
 * the consent signal a function the test fires. topic-rejoin.ts is production.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PortAnswer, TopicArrival } from '../../host/ports';
import type { TopicOpened } from '../../sdk/generated/TopicOpened';
import type { OwnedTopicPort } from '../topic-port';
import { JOIN_ATTEMPTS, rejoining, type RejoiningTopicPort, type TopicJoin } from '../topic-rejoin';

const INTERVAL_MS: number = 10_000;
const IN: PortAnswer<TopicOpened> = { ok: { name: 'cal', members: ['amy'] } };
const OUT: PortAnswer<TopicOpened> = { refused: { unavailable: 'topic' } };

interface Rig {
  readonly port: RejoiningTopicPort;
  readonly opens: () => number;
  readonly shown: TopicJoin[];
  readonly arrivals: TopicArrival[];
  readonly consentChanged: () => void;
}

/** `answers`: what each open gets, in turn; the last repeats. */
function rig(answers: readonly PortAnswer<TopicOpened>[]): Rig {
  let opens: number = 0;
  let consent: () => void = (): void => undefined;
  const inner: OwnedTopicPort = {
    TopicOpen: async (): Promise<PortAnswer<TopicOpened>> => answers[Math.min(opens++, answers.length - 1)],
    TopicPublish: async (): Promise<PortAnswer<null>> => ({ ok: null }),
    TopicClose: (): PortAnswer<null> => ({ ok: null }),
    closeAll: async (): Promise<void> => undefined,
    onEvent: (): (() => void) => (): void => undefined,
  };
  const shown: TopicJoin[] = [];
  const arrivals: TopicArrival[] = [];
  const port: RejoiningTopicPort = rejoining(inner, {
    intervalMs: INTERVAL_MS,
    after: (ms: number, fire: () => void): (() => void) => { const t: ReturnType<typeof setTimeout> = setTimeout(fire, ms); return (): void => clearTimeout(t); },
    owner: async (): Promise<string | null> => 'amy',
    consentChanges: (listener: () => void): (() => void) => { consent = listener; return (): void => undefined; },
    shown: (_topic: string, join: TopicJoin): void => { shown.push(join); },
  });
  port.onEvent((a: TopicArrival): void => { arrivals.push(a); });
  return { port, opens: () => opens, shown, arrivals, consentChanged: (): void => consent() };
}

const WAITING: TopicJoin = { kind: 'waiting', owner: 'amy' };

describe('a topic join', () => {
  afterEach(() => { vi.useRealTimers(); });

  it(`is tried at most ${JOIN_ATTEMPTS} times on the timer, then waits for the named owner and tries no more`, async () => {
    vi.useFakeTimers();
    const r: Rig = rig([OUT]);
    expect(await r.port.TopicOpen({ name: 'cal' })).toEqual(OUT);
    await vi.advanceTimersByTimeAsync(INTERVAL_MS - 1);
    expect(r.opens()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(r.opens()).toBe(2);
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(r.opens()).toBe(3);
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 30);
    expect(r.opens()).toBe(JOIN_ATTEMPTS);
    expect(r.shown).toEqual([
      { kind: 'joining', attempt: 1, of: 3 }, { kind: 'joining', attempt: 2, of: 3 }, { kind: 'joining', attempt: 3, of: 3 }, WAITING,
    ]);
  });

  it('Try again is one try, back to waiting when it fails', async () => {
    vi.useFakeTimers();
    const r: Rig = rig([OUT]);
    await r.port.TopicOpen({ name: 'cal' });
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3);
    r.port.tryAgain('cal');
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 30);
    expect([r.opens(), r.shown.slice(-2)]).toEqual([JOIN_ATTEMPTS + 1, [{ kind: 'joining', attempt: 1, of: 1 }, WAITING]]);
  });

  it('a consent change is one try; a join made then reaches the app as a members event', async () => {
    vi.useFakeTimers();
    const r: Rig = rig([OUT, OUT, OUT, IN]);
    await r.port.TopicOpen({ name: 'cal' });
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3);
    expect(r.shown.at(-1)).toEqual(WAITING);
    r.consentChanged();
    await vi.advanceTimersByTimeAsync(0);
    expect([r.opens(), r.shown.at(-1), r.arrivals]).toEqual([JOIN_ATTEMPTS + 1, { kind: 'in' }, [{ name: 'cal', event: { members: ['amy'] } }]]);
    r.consentChanged();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3);
    expect(r.opens()).toBe(JOIN_ATTEMPTS + 1);
  });

  it('closing the topic stops its tries', async () => {
    vi.useFakeTimers();
    const r: Rig = rig([OUT]);
    await r.port.TopicOpen({ name: 'cal' });
    await r.port.TopicClose({ name: 'cal' });
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 5);
    expect(r.opens()).toBe(1);
  });
});
