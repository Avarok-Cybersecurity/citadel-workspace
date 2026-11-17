import { describe, expect, it } from 'vitest';
import { LogCursor } from '../log-cursor';

describe('LogCursor', () => {
  it('places the next seq, an old one, and one past a gap', () => {
    const cursor: LogCursor = new LogCursor(3n);
    expect([cursor.place(4n), cursor.place(3n), cursor.place(6n)]).toEqual(['next', 'old', 'gap']);
  });

  it('holds our own update past a gap and steps over it once the gap is filled', () => {
    const cursor: LogCursor = new LogCursor(0n);
    expect(cursor.own(2n)).toBe(false);
    expect(cursor.contiguous).toBe(false);
    expect(cursor.place(2n)).toBe('old');
    cursor.advance(1n);
    expect(cursor.seq).toBe(2n);
    expect(cursor.contiguous).toBe(true);
  });

  it('refuses to advance past a gap', () => {
    expect(() => new LogCursor(1n).advance(3n)).toThrow('cannot advance');
  });

  it('a rebase over a snapshot keeps only what is held after it', () => {
    const cursor: LogCursor = new LogCursor(0n);
    cursor.own(3n);
    cursor.own(6n);
    cursor.rebase(5n);
    expect(cursor.seq).toBe(6n);
    expect(cursor.contiguous).toBe(true);
  });
});
