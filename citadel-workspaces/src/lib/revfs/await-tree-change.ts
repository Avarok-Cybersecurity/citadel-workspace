/**
 * Wait for a peer pair's tree to change, or give up.
 *
 * `requestSync` used to resolve as soon as the REQUEST was on the wire, and the
 * caller then told the user "Tree synced with peer" — a claim about an answer
 * nobody had waited for. Run 33304689050 shows how often that answer does not
 * come: a hundred redelivered sync requests crowding the reliable channel, with
 * the operations behind them never arriving.
 *
 * There is no id on the wire linking a `SyncResponse` back to its request, so
 * what is waited on is the tree for this pair changing at all. A change from
 * any source still means the view is fresher than it was, which is exactly what
 * the message claims — no more.
 */
import type { RevfsState } from './revfs-state';
import type { TreeKey } from '@/types/revfs-types';

export function awaitTreeChange(
  state: RevfsState,
  key: TreeKey,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const stop: () => void = state.onTreeChanged((changed: TreeKey): void => {
      if (changed !== key) return;
      clearTimeout(timer);
      stop();
      resolve(true);
    });
    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      stop();
      resolve(false);
    }, timeoutMs);
  });
}
