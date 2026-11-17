/**
 * Clocks a test steps by hand, standing in for setInterval and requestAnimationFrame where the
 * editor takes them as options (the caret's blink, a drag's auto-scroll). Justified: jsdom has
 * no frames, and stepping time explicitly shows exactly what one tick or one frame does.
 */
import type { Repeat } from '@/lib/cdoc/editor/caret-blink';

export class ManualRepeat {
  private readonly ticks: Map<number, { readonly ms: number; readonly tick: () => void }> = new Map();
  private next: number = 0;

  readonly repeat: Repeat = (ms: number, tick: () => void): (() => void) => {
    const id: number = this.next++;
    this.ticks.set(id, { ms, tick });
    return (): void => { this.ticks.delete(id); };
  };

  /** The periods of the repeats running now. */
  get running(): number[] {
    return [...this.ticks.values()].map((t) => t.ms);
  }

  /** One period of every running repeat. */
  tick(): void {
    for (const t of [...this.ticks.values()]) t.tick();
  }
}

export class ManualFrames {
  private tasks: (() => void)[] = [];

  readonly frame = (task: () => void): (() => void) => {
    this.tasks.push(task);
    return (): void => { this.tasks = this.tasks.filter((t) => t !== task); };
  };

  get pending(): number {
    return this.tasks.length;
  }

  /** Runs the frame: every task queued before it. */
  run(): void {
    const now: (() => void)[] = this.tasks;
    this.tasks = [];
    for (const task of now) task();
  }
}
