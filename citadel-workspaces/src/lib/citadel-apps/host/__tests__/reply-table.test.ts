/**
 * Reply-handle lifetime. The guest SDK abandons a reply it cannot reserve memory for (its
 * `try_reserve` failed) and the ABI has no release call, so a READY reply nobody reads must not
 * stay live: it is released `ttlMs` after it became ready, and its handle reads UNKNOWN_HANDLE.
 */
import { describe, expect, it } from 'vitest';
import { ABI_ERROR } from '../abi';
import { ReplyTable } from '../reply-table';
import { ManualClock } from './fakes';

const TTL: number = 2000;

describe('ReplyTable', () => {
  it('releases a ready reply nobody read once its TTL passes (control: just before, it is live)', () => {
    const clock: ManualClock = new ManualClock();
    const t: ReplyTable = new ReplyTable(4, TTL, clock.now);
    const h: number = t.ready(Uint8Array.of(1, 2, 3));
    clock.advance(TTL - 1);
    expect(t.length(h)).toBe(3);
    clock.advance(1);
    expect(t.length(h)).toBe(ABI_ERROR.UNKNOWN_HANDLE);
    expect(t.live).toBe(0);
  });

  it('abandoned replies cannot exhaust the table for longer than the TTL', () => {
    const clock: ManualClock = new ManualClock();
    const t: ReplyTable = new ReplyTable(2, TTL, clock.now);
    t.ready(new Uint8Array(1));
    t.ready(new Uint8Array(1));
    expect(t.ready(new Uint8Array(1))).toBe(ABI_ERROR.HANDLES_EXHAUSTED);
    clock.advance(TTL);
    expect(t.ready(new Uint8Array(1))).toBeGreaterThan(0);
  });

  it('a pending reply does not expire here; its TTL starts when it becomes ready', () => {
    const clock: ManualClock = new ManualClock();
    const t: ReplyTable = new ReplyTable(4, TTL, clock.now);
    const h: number = t.pending();
    clock.advance(TTL * 5);
    expect(t.length(h)).toBe(ABI_ERROR.PENDING);
    expect(t.resolve(h, Uint8Array.of(9))).toBe(true);
    clock.advance(TTL - 1);
    expect(t.length(h)).toBe(1);
    clock.advance(1);
    t.sweep();
    expect(t.live).toBe(0);
  });

  it('handles start at 1, and a read releases its handle', () => {
    const t: ReplyTable = new ReplyTable(4, TTL, new ManualClock().now);
    const memory: WebAssembly.Memory = new WebAssembly.Memory({ initial: 1 });
    const h: number = t.ready(Uint8Array.of(7));
    expect(h).toBe(1);
    expect(t.read(h, memory, 0, 8)).toBe(1);
    expect(t.read(h, memory, 0, 8)).toBe(ABI_ERROR.UNKNOWN_HANDLE);
  });
});
