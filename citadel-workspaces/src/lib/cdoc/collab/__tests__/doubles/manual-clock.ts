/** A Clock port that moves only when the test says so; timers fire in due order. */
import type { Clock } from '../../ports';

interface Timer {
  readonly due: number;
  readonly order: number;
  readonly fn: () => void;
}

export class ManualClock implements Clock {
  private time: number = 0;
  private order: number = 0;
  private timers: Timer[] = [];

  now(): number {
    return this.time;
  }

  after(ms: number, fn: () => void): () => void {
    const timer: Timer = { due: this.time + ms, order: this.order++, fn };
    this.timers.push(timer);
    return (): void => { this.timers = this.timers.filter((t: Timer): boolean => t !== timer); };
  }

  /** Moves time forward by `ms`, firing every timer that falls due on the way. */
  advance(ms: number): void {
    const end: number = this.time + ms;
    for (;;) {
      const next: Timer | undefined = [...this.timers].sort((a: Timer, b: Timer): number => a.due - b.due || a.order - b.order)[0];
      if (!next || next.due > end) break;
      this.timers = this.timers.filter((t: Timer): boolean => t !== next);
      this.time = next.due;
      next.fn();
    }
    this.time = end;
  }

  get pending(): number {
    return this.timers.length;
  }
}
