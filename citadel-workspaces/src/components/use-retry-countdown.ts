import { useEffect, useState, type MutableRefObject } from 'react';
import { getRetryDelay } from './connection-retry-types';
import { runAsyncSetup } from '@/lib/utils/async-utils';

/**
 * Counts down to the next automatic retry and fires it.
 *
 * Extracted from ConnectionRetryModal to keep it under the file cap. The
 * in-progress ref is threaded in rather than owned here because the manual
 * Retry button shares it — two paths firing the same retry at once is what the
 * ref exists to prevent.
 */
export function useRetryCountdown({
  isOpen,
  isLoading,
  attempt,
  maxRetries,
  maxBackoffSeconds,
  retryFnRef,
  retryInProgressRef,
}: {
  isOpen: boolean;
  isLoading: boolean;
  attempt: number;
  maxRetries: number;
  maxBackoffSeconds: number;
  retryFnRef: MutableRefObject<(() => Promise<unknown>) | null>;
  retryInProgressRef: MutableRefObject<boolean>;
}): { countdown: number; resetCountdown: () => void } {
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    if (!isOpen || isLoading || attempt === 0 || attempt >= maxRetries) return;

    const retryDelayMs: number = getRetryDelay(attempt, maxBackoffSeconds);
    const startTime: number = Date.now();
    setCountdown(Math.ceil(retryDelayMs / 1000));

    let hasTriggeredRetry: boolean = false;

    const updateProgress = (): void => {
      const elapsed: number = Date.now() - startTime;
      const remainingSeconds: number = Math.ceil((retryDelayMs - elapsed) / 1000);
      setCountdown(Math.max(remainingSeconds, 0));

      if (elapsed >= retryDelayMs && attempt < maxRetries && !hasTriggeredRetry && !retryInProgressRef.current) {
        hasTriggeredRetry = true;
        retryInProgressRef.current = true;

        const retryFn: (() => Promise<unknown>) | null = retryFnRef.current;
        if (retryFn) {
          runAsyncSetup(async () => {
            try {
              await retryFn();
            } finally {
              retryInProgressRef.current = false;
            }
          });
        }
      }
    };

    const interval: NodeJS.Timeout = setInterval(updateProgress, 100);

    return (): void => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, attempt, maxRetries, isLoading]);

  return { countdown, resetCountdown: () => setCountdown(0) };
}
