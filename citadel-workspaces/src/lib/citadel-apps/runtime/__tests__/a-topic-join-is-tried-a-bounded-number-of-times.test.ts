/**
 * A topic join nobody admits is tried at most JOIN_ATTEMPTS times on the timer, then waits, and the
 * wait says why, on whom, and how it ends (runtime/topic-rejoin.ts): a wait on an answer that did
 * not come tries by itself each `everyMs` until its deadline, then only on Try again; a wait on an
 * owner shown offline tries only once they are shown online; a refusal never tries by itself. Try
 * again or a consent change is one try; a join the host makes after the app's own open failed
 * reaches the app as a `members` event.
 *
 * TEST FAKE: the inner topic port is an in-memory OwnedTopicPort answering each open from a script
 * and naming why it left the member out (topic-port.ts and its agent are proven in their own
 * tests); the timer and the date are vitest's fake clock, presence and the consent signal are
 * functions the test sets and fires. topic-rejoin.ts is production.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PortAnswer, TopicArrival } from '../../host/ports';
import type { TopicOpened } from '../../sdk/generated/TopicOpened';
import type { JoinOut } from '../topic-admission';
import type { OwnedTopicPort } from '../topic-port';
import { JOIN_ATTEMPTS, rejoining, type RejoiningTopicPort, type TopicJoin, type TopicOwner } from '../topic-rejoin';

const INTERVAL_MS: number = 10_000;
/** The wait's pacing in these cases (production: TOPIC_WAIT): a try a minute, for five. */
const WAIT: { everyMs: number; forMs: number } = { everyMs: 60_000, forMs: 300_000 };
const IN: PortAnswer<TopicOpened> = { ok: { name: 'cal', members: ['amy'] } };
const OUT: PortAnswer<TopicOpened> = { refused: { unavailable: 'topic' } };
const AMY: TopicOwner = { username: 'amy', cid: 5n };

interface Rig {
  readonly port: RejoiningTopicPort;
  readonly opens: () => number;
  readonly shown: TopicJoin[];
  readonly arrivals: TopicArrival[];
  readonly consentChanged: () => void;
  /** What presence says of amy from now on. */
  readonly amyShown: (online: boolean | null) => void;
}

/** `answers`: what each open gets, in turn; the last repeats. `why`: what the port says left the member out. */
// Test defaults: amy's presence is not known, and the port says nobody answered.
function rig(answers: readonly PortAnswer<TopicOpened>[], why: JoinOut = 'timeout'): Rig {
  let opens: number = 0;
  let consent: () => void = (): void => undefined;
  let online: boolean | null = null;
  const inner: OwnedTopicPort = {
    TopicOpen: async (): Promise<PortAnswer<TopicOpened>> => answers[Math.min(opens++, answers.length - 1)],
    TopicPublish: async (): Promise<PortAnswer<null>> => ({ ok: null }),
    TopicClose: (): PortAnswer<null> => ({ ok: null }),
    closeAll: async (): Promise<void> => undefined,
    onEvent: (): (() => void) => (): void => undefined,
    outReason: (): JoinOut => why,
  };
  const shown: TopicJoin[] = [];
  const arrivals: TopicArrival[] = [];
  const port: RejoiningTopicPort = rejoining(inner, {
    intervalMs: INTERVAL_MS, wait: WAIT, nowMs: (): number => Date.now(),
    after: (ms: number, fire: () => void): (() => void) => { const t: ReturnType<typeof setTimeout> = setTimeout(fire, ms); return (): void => clearTimeout(t); },
    owner: async (): Promise<TopicOwner | null> => AMY,
    presence: (): boolean | null => online,
    consentChanges: (listener: () => void): (() => void) => { consent = listener; return (): void => undefined; },
    shown: (_topic: string, join: TopicJoin): void => { shown.push(join); },
  });
  port.onEvent((a: TopicArrival): void => { arrivals.push(a); });
  return { port, opens: () => opens, shown, arrivals, consentChanged: (): void => consent(), amyShown: (o: boolean | null): void => { online = o; } };
}

const waiting = (reason: 'timeout' | 'owner-offline' | 'refused', deadlineMs: number | null): TopicJoin =>
  ({ kind: 'waiting', reason, owner: AMY, wake: deadlineMs === null ? { kind: 'manual' } : { kind: 'auto', deadlineMs } });

/** Opens the topic and runs the timer round out: the member is waiting from the returned time. */
async function roundOut(r: Rig): Promise<number> {
  await r.port.TopicOpen({ name: 'cal' });
  await vi.advanceTimersByTimeAsync(INTERVAL_MS * (JOIN_ATTEMPTS - 1));
  return Date.now();
}

describe('a topic join', () => {
  afterEach(() => { vi.useRealTimers(); });

  it(`is tried ${JOIN_ATTEMPTS} times on the timer, then waits on the named owner, trying by itself until the deadline and no more`, async () => {
    vi.useFakeTimers();
    const r: Rig = rig([OUT]);
    expect(await r.port.TopicOpen({ name: 'cal' })).toEqual(OUT);
    await vi.advanceTimersByTimeAsync(INTERVAL_MS - 1);
    expect(r.opens()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(r.opens()).toBe(2);
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(r.opens()).toBe(3);
    const deadline: number = Date.now() + WAIT.forMs;
    expect(r.shown).toEqual([
      { kind: 'joining', attempt: 1, of: 3 }, { kind: 'joining', attempt: 2, of: 3 }, { kind: 'joining', attempt: 3, of: 3 }, waiting('timeout', deadline),
    ]);
    await vi.advanceTimersByTimeAsync(WAIT.everyMs);
    expect(r.opens(), 'the wait tries by itself').toBe(JOIN_ATTEMPTS + 1);
    expect(r.shown.at(-1), 'a try inside the wait keeps the wait shown, deadline and all').toEqual(waiting('timeout', deadline));
    await vi.advanceTimersByTimeAsync(WAIT.forMs);
    expect(r.opens()).toBe(JOIN_ATTEMPTS + WAIT.forMs / WAIT.everyMs);
    expect(r.shown.at(-1)).toEqual(waiting('timeout', null));
    await vi.advanceTimersByTimeAsync(WAIT.forMs * 3);
    expect(r.opens(), 'past the deadline nothing tries by itself').toBe(JOIN_ATTEMPTS + WAIT.forMs / WAIT.everyMs);
  });

  it('joins by itself when the answer comes inside the wait, and the app hears it', async () => {
    vi.useFakeTimers();
    const r: Rig = rig([OUT, OUT, OUT, OUT, IN]);
    await roundOut(r);
    await vi.advanceTimersByTimeAsync(WAIT.everyMs * 2);
    expect([r.opens(), r.shown.at(-1), r.arrivals]).toEqual([5, { kind: 'in' }, [{ name: 'cal', event: { members: ['amy'] } }]]);
  });

  it('on an owner shown offline, tries only once they are shown online', async () => {
    vi.useFakeTimers();
    const r: Rig = rig([OUT, OUT, OUT, IN]);
    r.amyShown(false);
    const from: number = await roundOut(r);
    expect(r.shown.at(-1)).toEqual(waiting('owner-offline', from + WAIT.forMs));
    await vi.advanceTimersByTimeAsync(WAIT.everyMs * 3);
    expect(r.opens(), 'nobody is asked while the owner is offline').toBe(JOIN_ATTEMPTS);
    r.amyShown(true);
    await vi.advanceTimersByTimeAsync(WAIT.everyMs);
    expect([r.opens(), r.shown.at(-1)]).toEqual([JOIN_ATTEMPTS + 1, { kind: 'in' }]);
  });

  it('a refusal never tries by itself', async () => {
    vi.useFakeTimers();
    const r: Rig = rig([OUT], 'refused');
    await roundOut(r);
    expect(r.shown.at(-1)).toEqual(waiting('refused', null));
    await vi.advanceTimersByTimeAsync(WAIT.forMs * 2);
    expect(r.opens()).toBe(JOIN_ATTEMPTS);
  });

  it('Try again is one try, then a new wait with a new deadline', async () => {
    vi.useFakeTimers();
    const r: Rig = rig([OUT]);
    await roundOut(r);
    await vi.advanceTimersByTimeAsync(WAIT.forMs);
    expect(r.shown.at(-1)).toEqual(waiting('timeout', null));
    const opened: number = r.opens();
    r.port.tryAgain('cal');
    await vi.advanceTimersByTimeAsync(0);
    expect([r.opens(), r.shown.slice(-2)]).toEqual([opened + 1, [{ kind: 'joining', attempt: 1, of: 1 }, waiting('timeout', Date.now() + WAIT.forMs)]]);
  });

  it('a consent change is one try; a join made then reaches the app as a members event', async () => {
    vi.useFakeTimers();
    const r: Rig = rig([OUT, OUT, OUT, IN], 'refused');
    await roundOut(r);
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
    await vi.advanceTimersByTimeAsync(WAIT.forMs * 2);
    expect(r.opens()).toBe(1);
  });
});
