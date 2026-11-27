/**
 * The part of a plan that needs no one: a wait for its signal, an automatic retry on its policy.
 * Either ends in one of two ways, `resolved` (the signal came, an attempt succeeded) or `manual`
 * (the deadline passed, the policy ran out), and `manual` is when the surface shows its `then`.
 * Time is the injected clock, so a test steps it.
 */
import type { AnyBinding, Wake } from './binding';
import { RETRY_DELAYS_MS } from './retry-policy';
import type { RecoveryRoute, WaitCondition } from './route';

export type AutoPhase =
  | { readonly kind: 'waiting'; readonly until: WaitCondition; readonly deadlineAt: number }
  | { readonly kind: 'retrying'; readonly attempt: number; readonly of: number; readonly nextAt: number }
  | { readonly kind: 'manual' }
  | { readonly kind: 'resolved' };

export interface AutoClock {
  now(): number;
  /** Runs `fn` once after `ms`; the returned function cancels it. */
  after(ms: number, fn: () => void): () => void;
}

/** The phase a plan starts in: a person acts at once unless the primary is a wait or a retry. */
export function initialPhase(primary: RecoveryRoute, clock: AutoClock): AutoPhase {
  if (primary.kind === 'wait') return { kind: 'waiting', until: primary.until, deadlineAt: clock.now() + primary.deadlineMs };
  if (primary.kind === 'retry-auto') {
    const delays: readonly number[] = RETRY_DELAYS_MS[primary.policy];
    return { kind: 'retrying', attempt: 1, of: delays.length, nextAt: clock.now() + delays[0] };
  }
  return { kind: 'manual' };
}

function need<T>(value: T | undefined, field: string): T {
  if (value === undefined) throw new Error(`an automatic route needs the binding's ${field}`);
  return value;
}

/** Drives the automatic phase, reporting each change; returns the function that stops it. */
export function runAutoPhase(primary: RecoveryRoute, binding: AnyBinding, clock: AutoClock, onPhase: (phase: AutoPhase) => void): () => void {
  let stopped: boolean = false;
  const cancels: (() => void)[] = [];
  const stop = (): void => {
    stopped = true;
    for (const cancel of cancels.splice(0)) cancel();
  };
  const settle = (phase: AutoPhase): void => {
    if (stopped) return;
    stop();
    onPhase(phase);
  };
  if (primary.kind === 'wait') {
    const wake: Wake = need(binding.wake, 'wake');
    cancels.push(wake((): void => settle({ kind: 'resolved' })));
    cancels.push(clock.after(primary.deadlineMs, (): void => settle({ kind: 'manual' })));
    return stop;
  }
  if (primary.kind === 'retry-auto') {
    const retry: () => Promise<void> = need(binding.retry, 'retry');
    const delays: readonly number[] = RETRY_DELAYS_MS[primary.policy];
    const attempt = (index: number): void => {
      cancels.push(clock.after(delays[index], (): void => {
        retry().then(
          (): void => settle({ kind: 'resolved' }),
          (): void => {
            if (stopped) return;
            if (index + 1 >= delays.length) { settle({ kind: 'manual' }); return; }
            onPhase({ kind: 'retrying', attempt: index + 2, of: delays.length, nextAt: clock.now() + delays[index + 1] });
            attempt(index + 1);
          },
        );
      }));
    };
    attempt(0);
    return stop;
  }
  return stop;
}
