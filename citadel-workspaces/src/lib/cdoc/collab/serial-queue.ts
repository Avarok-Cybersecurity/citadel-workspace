/**
 * Runs a session's steps one at a time in arrival order. A CRDT update must reach the editor
 * after the ones before it, and an answer handled while an earlier one is still awaiting the
 * worker would read the cursor before it moved.
 */
export class SerialQueue {
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly report: (error: unknown) => void) {}

  run(step: () => Promise<void>): Promise<void> {
    const next: Promise<void> = this.tail.then(step).catch((error: unknown): void => this.report(error));
    this.tail = next;
    return next;
  }

  /** Resolves once the queue is empty, including steps queued by the steps it waited for. */
  async idle(): Promise<void> {
    let seen: Promise<void>;
    do {
      seen = this.tail;
      await seen;
    } while (seen !== this.tail);
  }
}
