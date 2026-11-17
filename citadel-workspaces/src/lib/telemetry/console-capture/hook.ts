/**
 * Wraps a console's `error` and `warn` so each call is also handed to `onLine`, after the
 * original has printed it. Undone by the returned function, unless something has wrapped the
 * console since, which is then left as it is (its own undo restores ours).
 *
 * A console call made while a line is being handled is not handed on again, so nothing the
 * capture itself logs can feed back into it. `onLine` throwing calls `onFailure` instead of
 * reaching the caller: the app's own console call has already happened and must not fail.
 */
import type { ConsoleLevel } from './format';

export type ConsoleTarget = Record<ConsoleLevel, (...args: unknown[]) => void>;

const LEVELS: readonly ConsoleLevel[] = ['error', 'warn'];

export function hookConsole(
  target: ConsoleTarget,
  onLine: (level: ConsoleLevel, args: readonly unknown[]) => void,
  onFailure: () => void,
): () => void {
  const originals: ConsoleTarget = { error: target.error, warn: target.warn };
  let inside: boolean = false;
  const wrap = (level: ConsoleLevel): ((...args: unknown[]) => void) => (...args: unknown[]): void => {
    originals[level].apply(target, args);
    if (inside) return;
    inside = true;
    try {
      onLine(level, args);
    } catch {
      // Reporting this to the console would be captured; the capture stops instead.
      onFailure();
    } finally {
      inside = false;
    }
  };
  const wrappers: ConsoleTarget = { error: wrap('error'), warn: wrap('warn') };
  for (const level of LEVELS) target[level] = wrappers[level];
  return (): void => {
    for (const level of LEVELS) if (target[level] === wrappers[level]) target[level] = originals[level];
  };
}
