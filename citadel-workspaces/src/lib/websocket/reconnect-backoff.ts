/**
 * Spacing between attempts to open the leader's WebSocket to the agent.
 *
 * Every socket this tab opens goes through `createWebSocketAsLeader`, and that
 * asks this first. Without it, a socket that connected and then died at once
 * was replaced as fast as anything asked for one: the teardown reset the
 * service, the next request's `init()` opened a new socket, that one died too,
 * and so on for as long as the tab stayed open.
 *
 * A failed attempt and a connection that died young both count as failures.
 * A connection that stayed up for `stableAfterMs` clears them, so an outage
 * after a long healthy session is retried at once.
 *
 * An open asked for inside the window is REFUSED, not delayed. Every request
 * awaits `init()`, so a delay would have held each of them -- a storage write,
 * a read receipt -- for up to the whole cap, where before they failed at once
 * with the agent down. Whoever retries (the start-up retry, the retry dialog's
 * countdown, the next request) gets a real attempt once the window has passed.
 */

export interface ReconnectBackoffPolicy {
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  /** A connection that lived at least this long resets the backoff. */
  readonly stableAfterMs: number;
}

export interface BackoffClock {
  now(): number;
}

export class ReconnectDeferredError extends Error {
  constructor(readonly retryInMs: number) {
    super(`Not reconnecting to the Citadel agent yet: the last connection did not hold. Next attempt in ${Math.ceil(retryInMs / 1000)}s.`);
    this.name = 'ReconnectDeferredError';
  }
}

/** 1s, 2s, 4s ... capped at 30s; a connection up for 10s counts as healthy. */
export const AGENT_RECONNECT_BACKOFF: ReconnectBackoffPolicy = {
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  stableAfterMs: 10000,
};

export const systemClock: BackoffClock = {
  now: (): number => Date.now(),
};

export class ReconnectBackoff {
  private failures: number = 0;
  private lastEndedAt: number | null = null;
  private connectedAt: number | null = null;

  constructor(
    private readonly policy: ReconnectBackoffPolicy,
    private readonly clock: BackoffClock,
  ) {}

  /** How long the next attempt must still wait, measured from the last ending. */
  delayBeforeNextAttempt(): number {
    if (this.failures === 0 || this.lastEndedAt === null) return 0;
    const spacing: number = Math.min(
      this.policy.baseDelayMs * 2 ** (this.failures - 1),
      this.policy.maxDelayMs,
    );
    return Math.max(0, this.lastEndedAt + spacing - this.clock.now());
  }

  /** Throws ReconnectDeferredError while the window since the last ending is open. */
  admitAttempt(): void {
    const delay: number = this.delayBeforeNextAttempt();
    if (delay > 0) throw new ReconnectDeferredError(delay);
  }

  attemptFailed(): void {
    this.failures += 1;
    this.connectedAt = null;
    this.lastEndedAt = this.clock.now();
  }

  connected(): void {
    this.connectedAt = this.clock.now();
  }

  /** The live connection ended. Ignored when none was recorded as up. */
  disconnected(): void {
    if (this.connectedAt === null) return;
    const lived: number = this.clock.now() - this.connectedAt;
    this.connectedAt = null;
    this.lastEndedAt = this.clock.now();
    this.failures = lived >= this.policy.stableAfterMs ? 0 : this.failures + 1;
  }
}
