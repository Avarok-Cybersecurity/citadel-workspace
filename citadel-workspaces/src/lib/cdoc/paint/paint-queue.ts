/**
 * The one line every page paint waits in. At most `limit` paints run at once, a page in view
 * goes before a page painted ahead of the scroll, and a slot holds at most one waiting paint: a
 * newer request for the slot replaces it, and both callers get the newer paint's outcome (a
 * zoom gesture asks several times; only the last is worth drawing).
 *
 * A paint ahead competes with nothing it matters for: with one paint at a time, a page coming
 * into view waits for at most the paint already running, never for a queue of pages below it.
 */

/** In view now, or painted ahead of the scroll so it is warm when it arrives. */
export type PaintPriority = 'visible' | 'ahead';

interface Waiting {
  readonly slot: number;
  priority: PaintPriority;
  task: () => Promise<unknown>;
  readonly settle: Array<{ resolve: (value: unknown) => void; reject: (error: unknown) => void }>;
}

export class PaintQueue {
  private readonly waiting: Waiting[] = [];
  private running: number = 0;

  constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error(`a paint queue runs at least one paint at a time, not ${limit}`);
  }

  run<T>(slot: number, priority: PaintPriority, task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject): void => {
      const settle: Waiting['settle'][number] = { resolve: resolve as (value: unknown) => void, reject };
      const queued: Waiting | undefined = this.waiting.find((w: Waiting): boolean => w.slot === slot);
      if (queued === undefined) {
        this.waiting.push({ slot, priority, task, settle: [settle] });
      } else {
        queued.task = task;
        if (priority === 'visible') queued.priority = 'visible';
        queued.settle.push(settle);
      }
      this.pump();
    });
  }

  /** Forgets a slot's waiting paint (its canvas went away); a running one finishes. */
  drop(slot: number): void {
    const at: number = this.waiting.findIndex((w: Waiting): boolean => w.slot === slot);
    if (at >= 0) this.waiting.splice(at, 1);
  }

  /** Paints waiting, not counting those running: what a test or a probe can watch drain. */
  get pending(): number {
    return this.waiting.length;
  }

  private next(): Waiting | undefined {
    const visible: number = this.waiting.findIndex((w: Waiting): boolean => w.priority === 'visible');
    const at: number = visible >= 0 ? visible : 0;
    return this.waiting.splice(at, 1)[0];
  }

  private pump(): void {
    while (this.running < this.limit && this.waiting.length > 0) {
      const job: Waiting | undefined = this.next();
      if (job === undefined) return;
      this.running++;
      // Through a resolved promise, so a task that throws before its first await still settles.
      void Promise.resolve().then(job.task).then(
        (value: unknown): void => job.settle.forEach((s: Waiting['settle'][number]): void => s.resolve(value)),
        (error: unknown): void => job.settle.forEach((s: Waiting['settle'][number]): void => s.reject(error)),
      ).finally((): void => {
        this.running--;
        this.pump();
      });
    }
  }
}
