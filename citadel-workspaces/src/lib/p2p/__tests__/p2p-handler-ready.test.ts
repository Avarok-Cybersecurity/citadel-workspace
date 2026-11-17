/**
 * Messages that arrive before the P2P handler subscribes must not be lost —
 * and must not be stranded either.
 *
 * CI run 32912073077 lost msg_id=10 exactly this way: it was emitted twice to
 * EIGHT listeners, none of which was the P2P handler, which attached moments
 * later. The listener count is why the obvious guard does not work — several
 * unrelated services subscribe at module load, so the count is nonzero
 * precisely when it is least meaningful.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isP2PMessageHandlerAttached,
  markP2PMessageHandlerAttached,
  holdUntilP2PHandlerAttached,
  setP2PReplay,
  resetP2PHandlerReadyForTests,
} from '../p2p-handler-ready';

beforeEach(() => {
  resetP2PHandlerReadyForTests();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  resetP2PHandlerReadyForTests();
});

describe('holding messages until the P2P handler attaches', () => {
  it('holds before attach and replays on attach', () => {
    const delivered: unknown[] = [];
    setP2PReplay((m) => delivered.push(m));

    expect(isP2PMessageHandlerAttached()).toBe(false);
    expect(holdUntilP2PHandlerAttached({ id: 1 })).toBe(true);
    expect(holdUntilP2PHandlerAttached({ id: 2 })).toBe(true);
    expect(delivered).toEqual([]);

    markP2PMessageHandlerAttached();

    // In order: a conversation reordered by a replay is its own defect.
    expect(delivered).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('does not hold once attached', () => {
    setP2PReplay(() => undefined);
    markP2PMessageHandlerAttached();

    expect(holdUntilP2PHandlerAttached({ id: 1 })).toBe(false);
  });

  it('releases anyway if the handler never attaches', () => {
    const delivered: unknown[] = [];
    setP2PReplay((m) => delivered.push(m));

    holdUntilP2PHandlerAttached({ id: 1 });
    expect(delivered).toEqual([]);

    // An unbounded hold would trade a rare lost message for a permanently
    // stranded one, which is not an improvement.
    vi.advanceTimersByTime(2001);
    expect(delivered).toEqual([{ id: 1 }]);
  });

  it('a timeout release does not re-hold what it just released', () => {
    const delivered: unknown[] = [];
    // The real replay path re-enters the same hold check. Without a guard the
    // buffer never drains and the message is stranded forever — worse than the
    // loss this exists to prevent.
    setP2PReplay((m) => {
      const reheld: boolean = holdUntilP2PHandlerAttached(m);
      expect(reheld).toBe(false);
      delivered.push(m);
    });

    holdUntilP2PHandlerAttached({ id: 1 });
    vi.advanceTimersByTime(2001);

    expect(delivered).toEqual([{ id: 1 }]);
  });

  it('drops the oldest rather than refusing the newest when full', () => {
    const delivered: unknown[] = [];
    setP2PReplay((m) => delivered.push(m));

    for (let i: number = 0; i < 70; i += 1) holdUntilP2PHandlerAttached({ id: i });
    markP2PMessageHandlerAttached();

    // Capped at 64; if this many piled up the handler is not coming soon and
    // the recent messages are the ones still worth delivering.
    expect(delivered).toHaveLength(64);
    expect(delivered[delivered.length - 1]).toEqual({ id: 69 });
    expect(delivered[0]).toEqual({ id: 6 });
  });
});
