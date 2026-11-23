/**
 * When "Reconnecting" stops being a strip over the workspace and becomes the whole page
 * (outage.ts). The rule runs against a clock of its own: a wait shorter than the threshold
 * never shows the page, a longer one does, and a give-up shows it at once.
 */
import { describe, it, expect } from 'vitest';
import { createEscalation, OUTAGE_CODE, RECONNECT_ESCALATION_MS, showsSessionGone, type Escalation, type Outage, type OutageKind } from '../outage';

const SLOW: Outage = { kind: 'reconnect-slow', cid: 42n, signIn: null };
const GONE: Outage = { kind: 'server-unreachable', cid: 42n, signIn: { path: '/?u=alice', message: 'Sign in again.' } };

interface Clock { escalation: Escalation; shown: Array<Outage | null>; advance: (ms: number) => void }

function clock(): Clock {
  const shown: Array<Outage | null> = [];
  let now: number = 0;
  let timers: Array<{ at: number; run: () => void }> = [];
  const escalation: Escalation = createEscalation({
    after: (ms: number, run: () => void): (() => void) => {
      const timer: { at: number; run: () => void } = { at: now + ms, run };
      timers.push(timer);
      return (): void => { timers = timers.filter((t) => t !== timer); };
    },
    show: (next: Outage | null): void => { shown.push(next); },
  });
  const advance = (ms: number): void => {
    now += ms;
    const due: Array<{ at: number; run: () => void }> = timers.filter((t) => t.at <= now);
    timers = timers.filter((t) => t.at > now);
    for (const timer of due) timer.run();
  };
  return { escalation, shown, advance };
}

describe('a session whose server link is down', () => {
  it('shows nothing but the strip for an ordinary drop', () => {
    const c: Clock = clock();
    c.escalation.begin(SLOW, RECONNECT_ESCALATION_MS);
    c.advance(RECONNECT_ESCALATION_MS - 1);
    expect(c.shown).toEqual([]);
    c.escalation.end();
    c.advance(RECONNECT_ESCALATION_MS * 10);
    expect(c.shown).toEqual([null]);
  });

  it('becomes the whole page once the wait reaches the threshold', () => {
    const c: Clock = clock();
    c.escalation.begin(SLOW, RECONNECT_ESCALATION_MS);
    c.advance(RECONNECT_ESCALATION_MS);
    expect(c.shown).toEqual([SLOW]);
  });

  it('is the whole page at once on a give-up, and the pending wait does not replace it later', () => {
    const c: Clock = clock();
    c.escalation.begin(SLOW, RECONNECT_ESCALATION_MS);
    c.escalation.now(GONE);
    c.advance(RECONNECT_ESCALATION_MS * 10);
    expect(c.shown).toEqual([GONE]);
  });

  it('measures a second drop from its own start', () => {
    const c: Clock = clock();
    c.escalation.begin(SLOW, RECONNECT_ESCALATION_MS);
    c.advance(RECONNECT_ESCALATION_MS - 1);
    c.escalation.begin(SLOW, RECONNECT_ESCALATION_MS);
    c.advance(RECONNECT_ESCALATION_MS - 1);
    expect(c.shown).toEqual([]);
    c.advance(1);
    expect(c.shown).toEqual([SLOW]);
  });

  it('waits long enough for a server that restarts, and not for minutes', () => {
    expect(RECONNECT_ESCALATION_MS).toBeGreaterThanOrEqual(10_000);
    expect(RECONNECT_ESCALATION_MS).toBeLessThanOrEqual(30_000);
  });
});

describe('the code a notice shows', () => {
  it('is one short stable code per kind, none shared', () => {
    const kinds: OutageKind[] = ['reconnect-slow', 'server-unreachable', 'workspace-timeout'];
    const codes: string[] = kinds.map((kind: OutageKind): string => OUTAGE_CODE[kind]);
    expect(codes).toEqual(['CW-LINK-SLOW', 'CW-SRV-UNREACHABLE', 'CW-LOAD-TIMEOUT']);
    expect(new Set(codes).size).toBe(kinds.length);
    for (const code of codes) expect(code).toMatch(/^CW-[A-Z]+(-[A-Z]+)*$/);
  });
});

describe('the end of a session the page already says is gone', () => {
  it('is that same event only for the give-up of that session', () => {
    expect(showsSessionGone(GONE, 42n)).toBe(true);
    expect(showsSessionGone(GONE, 7n)).toBe(false);
    // A wait is not a give-up: a session that ends during it ended some other way.
    expect(showsSessionGone(SLOW, 42n)).toBe(false);
    expect(showsSessionGone(null, 42n)).toBe(false);
  });
});
