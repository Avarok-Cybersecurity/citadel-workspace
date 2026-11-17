/**
 * How an instance's close ended, and the one pending close of an instance. Closing is a bounded
 * cleanup contract: `app_close` and the replies it waits on get the install's `close_grace_ms`
 * (the manifest's, at most MAX_CLOSE_GRACE_MS), after which the worker is ended whatever it is
 * doing. The grace is what the app was promised, not a timeout to retry after: nothing is retried.
 */
import type { CloseReason } from '../sdk/generated/CloseReason';
import type { DispatchClock } from './dispatch';

export type CloseEnding =
  /** app_close ran and every reply it waited on was delivered. */
  | 'settled'
  /** The grace ran out first; the worker was ended. */
  | 'grace-expired'
  /** The app trapped while closing (a panic in close, or the watchdog). */
  | 'trapped'
  /** It never got as far as app_init answering OK; there was nothing to close. */
  | 'not-started'
  /** It had already stopped (trapped, unresponsive, terminated, or closed before). */
  | 'already-stopped';

export interface CloseOutcome {
  readonly reason: CloseReason;
  readonly ending: CloseEnding;
  /** What app_close answered (CLOSE_RESULT), when it returned at all. */
  readonly closeResult: number | null;
  readonly ms: number;
}

/** One close in progress: its grace, and the promise every caller of close() shares. */
export class PendingClose {
  readonly outcome: Promise<CloseOutcome>;
  closeResult: number | null = null;
  private resolve: ((outcome: CloseOutcome) => void) | null = null;
  private readonly startedAt: number;
  private cancelGrace: (() => void) | null = null;

  constructor(readonly reason: CloseReason, private readonly clock: DispatchClock) {
    this.startedAt = clock.now();
    this.outcome = new Promise<CloseOutcome>((resolve: (o: CloseOutcome) => void): void => {
      this.resolve = resolve;
    });
  }

  /** Arms the grace; `expired` ends the instance when it fires. */
  arm(graceMs: number, expired: () => void): void {
    this.cancelGrace = this.clock.after(graceMs, expired);
  }

  /** The first ending wins; later ones are no-ops. */
  end(ending: CloseEnding): void {
    this.cancelGrace?.();
    this.cancelGrace = null;
    const resolve: ((o: CloseOutcome) => void) | null = this.resolve;
    this.resolve = null;
    resolve?.({ reason: this.reason, ending, closeResult: this.closeResult, ms: this.clock.now() - this.startedAt });
  }
}
