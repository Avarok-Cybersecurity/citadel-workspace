/**
 * A leader that learns a newer build is open in another tab hands leadership over to it.
 *
 * It answers what it has already started, takes nothing new (the senders' outbound queues
 * re-send those requests to the next leader), and then gives leadership up, which makes the
 * other tabs re-elect; this tab, being stale, does not stand. If the newer tab has closed in
 * the meantime there is nobody to hand over to, and it keeps leading.
 */
export interface HandoverIO {
  isLeading: () => boolean;
  /** Whether requests this leader started are still running. */
  busy: () => boolean;
  newerTabIsOpen: () => boolean;
  relinquish: () => void;
}

export class StaleLeaderHandover {
  private requested: boolean = false;

  constructor(private readonly io: HandoverIO) {}

  /** True from the request until leadership is given up: start nothing new. */
  get pending(): boolean {
    return this.requested;
  }

  request(): void {
    if (!this.io.isLeading()) return;
    this.requested = true;
    this.settle();
  }

  /** Called whenever a running request finishes. */
  settle(): void {
    if (!this.requested || this.io.busy()) return;
    this.requested = false;
    if (this.io.newerTabIsOpen()) this.io.relinquish();
  }

  /** Leadership changed by some other path; nothing is left to hand over. */
  cancel(): void {
    this.requested = false;
  }
}
