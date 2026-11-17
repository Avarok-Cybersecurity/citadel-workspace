/**
 * The rules for following a chat, with no DOM: pinned follows, unpinned
 * counts, View clears the count, reaching the bottom clears it.
 */
import { describe, it, expect } from 'vitest';
import { step, appendedSince, atBottom, unseenLabel, INITIAL_STICK, type StickState, type StickStep, type Geometry } from '../stick';

const at = (scrollTop: number, scrollHeight: number = 1000, clientHeight: number = 400): Geometry => ({ scrollTop, scrollHeight, clientHeight });
const scrolled = (g: Geometry): { type: 'scrolled'; geometry: Geometry } => ({ type: 'scrolled', geometry: g });
const arrived = (count: number, own: boolean = false): { type: 'appended'; count: number; own: boolean } => ({ type: 'appended', count, own });

function run(start: StickState, ...events: Parameters<typeof step>[1][]): StickStep {
  let result: StickStep = { state: start, scroll: false };
  for (const e of events) result = step(result.state, e);
  return result;
}

describe('a pinned reader', () => {
  it('follows a new message', () => {
    const r: StickStep = run(INITIAL_STICK, scrolled(at(600)), arrived(1));
    expect(r.scroll).toBe(true);
    expect(r.state.unseen).toBe(0);
  });

  it('is judged by where they were, not by the content that just grew', () => {
    // At the bottom (600 + 400 = 1000). The message then grows scrollHeight to
    // 1300: distance is now 300, but no scroll event has fired.
    const r: StickStep = run(INITIAL_STICK, scrolled(at(600)), arrived(1));
    expect(r.state.pinned).toBe(true);
    expect(r.scroll).toBe(true);
  });

  it('is re-pinned when content resizes (a late image)', () => {
    expect(run(INITIAL_STICK, scrolled(at(600)), { type: 'resized' }).scroll).toBe(true);
  });
});

describe('a reader who scrolled up', () => {
  const up: StickState = run(INITIAL_STICK, scrolled(at(100))).state;

  it('is not moved by a new message, and the arrivals are counted', () => {
    const r: StickStep = run(up, arrived(1), arrived(2));
    expect(r.scroll).toBe(false);
    expect(r.state.unseen).toBe(3);
  });

  it('is not moved by a resize', () => {
    expect(run(up, { type: 'resized' }).scroll).toBe(false);
  });

  it('View scrolls to the bottom and clears the count', () => {
    const r: StickStep = run(up, arrived(2), { type: 'view' });
    expect(r.scroll).toBe(true);
    expect(r.state.unseen).toBe(0);
    expect(r.state.pinned).toBe(true);
  });

  it('clears the count on scrolling to the bottom by hand', () => {
    const r: StickStep = run(up, arrived(2), scrolled(at(600)));
    expect(r.state.unseen).toBe(0);
    expect(r.state.pinned).toBe(true);
  });

  it('follows their own message', () => {
    const r: StickStep = run(up, arrived(1, true));
    expect(r.scroll).toBe(true);
    expect(r.state.unseen).toBe(0);
  });
});

describe('our own smooth scroll', () => {
  it('passing through the middle does not unpin; the reader moving up does', () => {
    const viewing: StickState = run(INITIAL_STICK, scrolled(at(100)), { type: 'view' }).state;
    const passing: StickState = step(viewing, scrolled(at(300))).state;
    expect(passing.pinned).toBe(true);
    expect(step(passing, arrived(1)).scroll).toBe(true);
    const interrupted: StickState = step(passing, scrolled(at(250))).state;
    expect(interrupted.pinned).toBe(false);
  });
});

describe('appendedSince', () => {
  const ids = (...s: string[]): { id: string }[] => s.map((id) => ({ id }));

  it('counts only what was added at the end', () => {
    expect(appendedSince(ids('a', 'b'), ids('a', 'b', 'c', 'd')).map((i) => i.id)).toEqual(['c', 'd']);
  });
  it('ignores an older page prepended', () => {
    expect(appendedSince(ids('c', 'd'), ids('a', 'b', 'c', 'd'))).toEqual([]);
  });
  it('treats the first paint and an unrelated replacement as no arrival', () => {
    expect(appendedSince([], ids('a'))).toEqual([]);
    expect(appendedSince(ids('a'), ids('x', 'y'))).toEqual([]);
  });
});

describe('labels and thresholds', () => {
  it('pluralises', () => {
    expect(unseenLabel(1)).toBe('1 new message');
    expect(unseenLabel(2)).toBe('2 new messages');
    expect(unseenLabel(99)).toBe('99 new messages');
    expect(unseenLabel(151)).toBe('99+ new messages');
  });
  it('treats a few pixels of slack as the bottom', () => {
    expect(atBottom(at(590))).toBe(true);
    expect(atBottom(at(500))).toBe(false);
  });
});
