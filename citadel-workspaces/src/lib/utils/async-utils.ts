import { debugLog } from '../debug-config';

/**
 * Standard wrapper for fire-and-forget async operations.
 * Replaces the old pattern with a named, greppable function call using debugLog.
 */
export function runAsyncSetup(fn: () => Promise<unknown>): void {
  fn().catch((err: unknown) => debugLog('AsyncUtils', 'runAsyncSetup error:', err));
}
