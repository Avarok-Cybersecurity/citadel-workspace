/**
 * One holder per name across this browser's windows: the member's Calendar work runs in the window
 * that holds `calendar-runner:<member>` and nowhere else (calendar-background.ts). A window waits
 * its turn; when the holder closes or crashes, the browser hands the lock to the next. Per member,
 * not per browser: two members signed in to two windows each run their own.
 */
export interface RunnerLock {
  /** Resolves with the release once held; rejects when `signal` aborts first. */
  hold(name: string, signal: AbortSignal): Promise<() => void>;
}

export const runnerLockName = (member: string): string => `calendar-runner:${member}`;

/** The Web Locks API. Its absence is an error, never "this window holds it". */
export function browserRunnerLock(): RunnerLock {
  const locks: LockManager | undefined = typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (!locks) throw new Error('This browser has no Web Locks API, so the Calendar cannot tell which window runs its reminders');
  return {
    hold: (name: string, signal: AbortSignal): Promise<() => void> => new Promise<() => void>((granted: (release: () => void) => void, failed: (cause: unknown) => void): void => {
      locks.request(name, { signal }, (): Promise<void> => new Promise<void>((release: () => void): void => granted(release))).catch(failed);
    }),
  };
}
