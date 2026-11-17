/**
 * Waiting for a paid workspace to exist.
 *
 * Stripe sends the visitor back before the control plane has necessarily heard
 * from Stripe: the webhook and the redirect race. So the return page asks
 * `/status` until the tenant is active, and has to stop for exactly four
 * reasons -- it is active, it has been too long, the control plane refused, or
 * the visitor left. Each is a different screen, so each is a different outcome.
 *
 * Pure apart from what it is handed: the clock, the sleep and the request are
 * all injected, so the stop conditions are tested without timers or network.
 */
import { ControlPlaneError, type TenantStatus } from './control-plane-client';

export type PollOutcome =
  | { readonly kind: 'active'; readonly claimCode: string | undefined; readonly workspaceHost: string | undefined }
  | { readonly kind: 'timed-out' }
  | { readonly kind: 'failed'; readonly error: ControlPlaneError }
  | { readonly kind: 'aborted' };

export interface PollOptions {
  readonly fetchStatus: (signal: AbortSignal) => Promise<TenantStatus>;
  readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  readonly now: () => number;
  readonly signal: AbortSignal;
  readonly intervalMs: number;
  readonly timeoutMs: number;
  /** Transient failures (no answer, a 5xx) tolerated in a row before giving up. */
  readonly maxConsecutiveFailures: number;
}

/** What the return page uses. Stripe's webhook is usually seconds behind the redirect. */
export const PROVISIONING_POLL = {
  intervalMs: 2000,
  timeoutMs: 120_000,
  maxConsecutiveFailures: 3,
} as const;

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export async function pollUntilActive(options: PollOptions): Promise<PollOutcome> {
  const started: number = options.now();
  let failures: number = 0;

  for (;;) {
    if (options.signal.aborted) return { kind: 'aborted' };
    try {
      const status: TenantStatus = await options.fetchStatus(options.signal);
      failures = 0;
      if (status.status === 'active') {
        return { kind: 'active', claimCode: status.claimCode, workspaceHost: status.workspaceHost };
      }
    } catch (error: unknown) {
      if (options.signal.aborted || isAbort(error)) return { kind: 'aborted' };
      const refused: ControlPlaneError =
        error instanceof ControlPlaneError ? error : new ControlPlaneError(0, String(error), undefined);
      if (!refused.transient) return { kind: 'failed', error: refused };
      failures += 1;
      if (failures >= options.maxConsecutiveFailures) return { kind: 'failed', error: refused };
    }

    if (options.now() - started >= options.timeoutMs) return { kind: 'timed-out' };
    try {
      await options.sleep(options.intervalMs, options.signal);
    } catch (error: unknown) {
      if (isAbort(error) || options.signal.aborted) return { kind: 'aborted' };
      throw error;
    }
  }
}

/** A real sleep that an abort cuts short. */
export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
