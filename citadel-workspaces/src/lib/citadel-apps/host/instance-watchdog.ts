/**
 * The compute watchdog of one instance (design 2.3): every message that makes the worker run guest
 * code is outstanding until the worker answers it, and the oldest outstanding one has the budget
 * from the moment it became the oldest. Pure over the injected clock.
 */
import type { DispatchClock } from './dispatch';

export class Watchdog {
  private readonly outstanding: Set<number> = new Set<number>();
  private cancel: (() => void) | null = null;

  constructor(private readonly clock: DispatchClock, private readonly budgetMs: number, private readonly expired: () => void) {}

  begin(seq: number): void {
    this.outstanding.add(seq);
    if (this.outstanding.size === 1) this.arm();
  }

  finish(seq: number): void {
    const oldest: number | undefined = this.outstanding.values().next().value;
    this.outstanding.delete(seq);
    if (seq === oldest) this.arm();
  }

  /** Nothing is outstanding any more, and nothing will fire. */
  clear(): void {
    this.cancel?.();
    this.cancel = null;
    this.outstanding.clear();
  }

  private arm(): void {
    this.cancel?.();
    this.cancel = null;
    if (this.outstanding.size > 0) this.cancel = this.clock.after(this.budgetMs, this.expired);
  }
}
