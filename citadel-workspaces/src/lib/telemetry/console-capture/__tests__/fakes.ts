/**
 * The two I/O edges console capture has, replaced by hand: time, and a console. Justified: the
 * buffer's window and flush are about time, which a test must step rather than wait out, and the
 * console under test cannot be the test runner's own.
 */
import type { CaptureClock } from '../buffer';
import type { ConsoleTarget } from '../hook';

export class ManualClock implements CaptureClock {
  private at: number = 1_000_000;
  private timers: { due: number; fn: () => void; live: boolean }[] = [];

  now(): number {
    return this.at;
  }

  after(ms: number, fn: () => void): () => void {
    const timer: { due: number; fn: () => void; live: boolean } = { due: this.at + ms, fn, live: true };
    this.timers.push(timer);
    return (): void => { timer.live = false; };
  }

  /** Moves time on by `ms`, running each timer that falls due, in order. */
  advance(ms: number): void {
    this.at += ms;
    const due: { due: number; fn: () => void; live: boolean }[] = this.timers.filter((t) => t.live && t.due <= this.at).sort((a, b) => a.due - b.due);
    this.timers = this.timers.filter((t) => t.live && t.due > this.at);
    for (const timer of due) timer.fn();
  }
}

/** A console whose calls are recorded; `printed` is what reached the original methods. */
export function recordingConsole(): ConsoleTarget & { printed: [string, unknown[]][] } {
  const printed: [string, unknown[]][] = [];
  return {
    printed,
    error: (...args: unknown[]): void => { printed.push(['error', args]); },
    warn: (...args: unknown[]): void => { printed.push(['warn', args]); },
  };
}
