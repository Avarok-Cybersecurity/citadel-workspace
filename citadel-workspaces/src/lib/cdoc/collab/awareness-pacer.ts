/**
 * When to send our awareness record: as soon as the selection moves, but never faster than the
 * kernel relays it, and again after a quiet `heartbeatMs` so peers do not expire us.
 *
 * The kernel's limiter (`kernel/rate_limiter.rs`) grants `awareness_per_second` payloads per
 * session per fixed one-second window, so sends at least `1000 / awareness_per_second` ms apart
 * can never be refused by it. Moves inside that interval coalesce into one trailing send of the
 * newest record: the record is read when it is sent, not when it was asked for.
 */
import type { Clock } from './ports';

export class AwarenessPacer {
  private readonly minIntervalMs: number;
  private lastSentAt: number | null = null;
  private cancelTimer: (() => void) | null = null;
  private sending: boolean = false;
  private dirty: boolean = false;
  private stopped: boolean = false;

  constructor(
    private readonly clock: Clock,
    perSecond: number,
    private readonly heartbeatMs: number,
    private readonly send: () => Promise<void>,
    private readonly report: (error: unknown) => void,
  ) {
    if (!(perSecond > 0)) throw new Error('awareness rate must be positive');
    this.minIntervalMs = Math.ceil(1000 / perSecond);
  }

  /** The selection moved (or the link came back): send the record soon. */
  request(): void {
    if (this.stopped) return;
    this.dirty = true;
    if (this.sending) return;
    const now: number = this.clock.now();
    const due: number = this.lastSentAt === null ? now : this.lastSentAt + this.minIntervalMs;
    this.schedule(Math.max(0, due - now));
  }

  stop(): void {
    this.stopped = true;
    this.clearTimer();
  }

  private schedule(delayMs: number): void {
    this.clearTimer();
    if (delayMs === 0) {
      this.flush();
      return;
    }
    this.cancelTimer = this.clock.after(delayMs, (): void => { this.cancelTimer = null; this.flush(); });
  }

  private flush(): void {
    if (this.stopped || !this.dirty) return;
    this.dirty = false;
    this.sending = true;
    this.lastSentAt = this.clock.now();
    void this.send()
      .catch((error: unknown): void => this.report(error))
      .finally((): void => this.afterSend());
  }

  private afterSend(): void {
    this.sending = false;
    if (this.stopped) return;
    if (this.dirty) this.request();
    else this.cancelTimer = this.clock.after(this.heartbeatMs, (): void => { this.cancelTimer = null; this.request(); });
  }

  private clearTimer(): void {
    if (this.cancelTimer) this.cancelTimer();
    this.cancelTimer = null;
  }
}
