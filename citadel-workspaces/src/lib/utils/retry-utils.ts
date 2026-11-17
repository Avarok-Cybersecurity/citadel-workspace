/**
 * Retry Utilities
 *
 * Provides reusable retry logic with exponential backoff.
 */

import { INTERVAL } from '../timeout-constants';

export interface RetryOptions {
  /** Base delay in milliseconds (default: 1000) */
  baseDelayMs?: number;
  /** Maximum delay in milliseconds (default: 30000) */
  maxDelayMs?: number;
  /** Maximum number of attempts (default: Infinity) */
  maxAttempts?: number;
  /** Optional jitter factor (0-1) to randomize delays (default: 0) */
  jitter?: number;
  /** Called before each retry with attempt info */
  onRetry?: (attempt: number, delay: number, error?: Error) => void;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  baseDelayMs: 1000,
  maxDelayMs: INTERVAL.HEALTH_CHECK_MS,
  maxAttempts: Infinity,
  jitter: 0,
  onRetry: () => {}
};

/**
 * Calculates the delay for a given attempt using exponential backoff.
 * @param attempt - The attempt number (0-indexed)
 * @param options - Retry options
 * @returns Delay in milliseconds
 */
export function calculateBackoffDelay(attempt: number, options: RetryOptions = {}): number {
  const { baseDelayMs, maxDelayMs, jitter } = { ...DEFAULT_OPTIONS, ...options };

  // Exponential backoff: base * 2^attempt
  let delay: number = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);

  // Apply jitter if configured
  if (jitter > 0) {
    const jitterRange: number = delay * jitter;
    delay = delay + (Math.random() * jitterRange * 2) - jitterRange;
    delay = Math.max(0, delay);
  }

  return Math.floor(delay);
}

/**
 * Executes a function with retry logic and exponential backoff.
 * @param fn - The async function to execute
 * @param options - Retry options
 * @returns The result of the function
 * @throws The last error if all retries fail
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts: Required<RetryOptions> = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error | undefined;

  for (let attempt: number = 0; attempt < opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt + 1 >= opts.maxAttempts) {
        break;
      }

      const delay: number = calculateBackoffDelay(attempt, opts);
      opts.onRetry(attempt + 1, delay, lastError);
      await sleep(delay);
    }
  }

  throw lastError ?? new Error('Retry failed with no error captured');
}

/**
 * Creates a retry scheduler that tracks attempts and manages timeouts.
 * Useful for long-running background retry operations.
 */
export class RetryScheduler {
  private readonly options: Required<RetryOptions>;
  private currentAttempt: number = 0;
  private timeoutId: ReturnType<typeof setTimeout> | null = null;
  private _isCancelled: boolean = false;

  constructor(options: RetryOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Schedules the next retry.
   * @param callback - Function to call after delay
   * @returns The scheduled delay in ms, or null if max attempts reached
   */
  scheduleNext(callback: () => void): number | null {
    if (this._isCancelled) {
      return null;
    }

    if (this.currentAttempt >= this.options.maxAttempts) {
      return null;
    }

    const delay: number = calculateBackoffDelay(this.currentAttempt, this.options);
    this.currentAttempt++;

    this.options.onRetry(this.currentAttempt, delay);

    this.timeoutId = setTimeout(() => {
      if (!this._isCancelled) {
        callback();
      }
    }, delay);

    return delay;
  }

  /**
   * Resets the attempt counter.
   */
  reset(): void {
    this.currentAttempt = 0;
    this.cancel();
    this._isCancelled = false;
  }

  /**
   * Cancels any scheduled retry.
   */
  cancel(): void {
    this._isCancelled = true;
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }

  /**
   * Gets the current attempt number.
   */
  get attempts(): number {
    return this.currentAttempt;
  }

  /**
   * Checks if the scheduler is cancelled.
   */
  get isCancelled(): boolean {
    return this._isCancelled;
  }

  /**
   * Checks if max attempts have been reached.
   */
  get isExhausted(): boolean {
    return this.currentAttempt >= this.options.maxAttempts;
  }
}

/**
 * Sleep for a given duration.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Creates a deferred promise that can be resolved/rejected externally.
 */
export function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;

  const promise: Promise<T> = new Promise<T>((res, rej): void => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}
