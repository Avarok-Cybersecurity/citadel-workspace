/**
 * The browser's clock as the Clock port: what the document session and the title bar run on.
 * Outside lib/cdoc so the title bar can take it without the shell reaching cdoc (cdoc-loads-lazily).
 */
import type { Clock } from '@/lib/cdoc/collab/ports';

export const browserClock: Clock = {
  now: (): number => performance.now(),
  after: (ms: number, fn: () => void): (() => void) => {
    const handle: ReturnType<typeof setTimeout> = setTimeout(fn, ms);
    return (): void => clearTimeout(handle);
  },
};
