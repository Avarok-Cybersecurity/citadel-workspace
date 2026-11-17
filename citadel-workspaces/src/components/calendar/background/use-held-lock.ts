/**
 * Whether this window holds `name` (runner-lock.ts), while `name` is not null: false while it
 * waits its turn, true once held, and let go when the name changes or the window unmounts.
 */
import { useEffect, useState } from 'react';
import type { RunnerLock } from '@/lib/calendar/runner-lock';

export function useHeldLock(lock: RunnerLock, name: string | null): boolean {
  const [held, setHeld] = useState<boolean>(false);
  useEffect(() => {
    setHeld(false);
    if (name === null) return undefined;
    const waiting: AbortController = new AbortController();
    let release: (() => void) | null = null;
    lock.hold(name, waiting.signal).then((letGo: () => void): void => {
      if (waiting.signal.aborted) {
        letGo();
        return;
      }
      release = letGo;
      setHeld(true);
    }, (error: unknown): void => {
      if (!waiting.signal.aborted) console.error(`[calendar] ${name} could not be held`, error);
    });
    return (): void => {
      waiting.abort();
      release?.();
    };
  }, [lock, name]);
  return held;
}
