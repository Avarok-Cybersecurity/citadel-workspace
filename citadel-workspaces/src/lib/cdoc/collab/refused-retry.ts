/**
 * Bounded retries of requests the server refused for now: Appends dropped because the session
 * sent too fast (AppendRateLimited) or the log is full until the server compacts it (LogFull),
 * and Pulls dropped by PullRateLimited. The dropped updates stay in the outbox, so a retry
 * resends what is still unacknowledged.
 *
 * One pending retry answers every refusal until it runs; once `delaysMs` is spent the refusal
 * is reported, once, and retries carry on at the last delay, so "retrying" stays true. Any
 * success resets it, and `now` (the server compacted the log) retries at once, but only when
 * something was refused.
 */
import type { DocumentRefusal } from 'citadel-workspace-client-ts';
import type { Clock } from './ports';
import { retryLater } from './session-errors';

class RefusedRetry {
  private attempt: number = 0;
  private refusedSinceSuccess: DocumentRefusal | null = null;
  private cancel: (() => void) | null = null;

  constructor(
    private readonly clock: Clock,
    private readonly delaysMs: readonly number[],
    private readonly retry: () => void,
    private readonly exhausted: (last: DocumentRefusal) => void,
  ) {
    if (delaysMs.length === 0 || delaysMs.some((d: number): boolean => !(d > 0))) throw new Error('refused requests need at least one positive retry delay');
  }

  refused(refusal: DocumentRefusal): void {
    this.refusedSinceSuccess = refusal;
    if (this.cancel) return;
    if (this.attempt === this.delaysMs.length) this.exhausted(refusal);
    const delay: number = this.delaysMs[Math.min(this.attempt, this.delaysMs.length - 1)];
    this.cancel = this.clock.after(delay, (): void => { this.cancel = null; this.retry(); });
    if (this.attempt <= this.delaysMs.length) this.attempt += 1;
  }

  succeeded(): void {
    this.attempt = 0;
    this.refusedSinceSuccess = null;
  }

  now(): void {
    if (this.refusedSinceSuccess === null) return;
    this.stop();
    this.attempt = 0;
    this.retry();
  }

  stop(): void {
    if (this.cancel) this.cancel();
    this.cancel = null;
  }
}

/** The session's two retries: refused Appends resend the outbox, refused Pulls pull again. */
export class HeldRequests {
  readonly appends: RefusedRetry;
  readonly pulls: RefusedRetry;

  constructor(clock: Clock, delaysMs: readonly number[], resend: () => void, pull: () => void, persisted: (last: DocumentRefusal) => void) {
    this.appends = new RefusedRetry(clock, delaysMs, resend, persisted);
    this.pulls = new RefusedRetry(clock, delaysMs, pull, persisted);
  }

  /** Which request `refusal` holds back, now scheduled for a retry; null when it is not one to retry. */
  refused(refusal: DocumentRefusal): 'append' | 'pull' | null {
    const later: 'append' | 'pull' | null = retryLater(refusal);
    if (later) (later === 'append' ? this.appends : this.pulls).refused(refusal);
    return later;
  }

  stop(): void {
    this.appends.stop();
    this.pulls.stop();
  }
}
