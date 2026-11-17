/**
 * Whether reloading this page now would cost the user something a reload cannot carry.
 *
 * The app reloads a stale tab by itself when nobody is looking (stale-auto-reload.ts). Drafts
 * survive that (draft-handoff.ts), and so do Docs edits (local-edits.ts); these do not:
 * - a call in progress, which the reload would hang up;
 * - a file being uploaded from this page, whose bytes only this page holds;
 * - an unsaved MDX edit, which lives in the editor's component state.
 * Each holds the reload while it lasts; the reload waits until nothing does.
 */
import { notifyEach } from '@/lib/notify-listeners';

const holds: Map<symbol, string> = new Map<symbol, string>();
const listeners: Set<() => void> = new Set<() => void>();

/** Hold reloads for `reason` until the returned release is called (once; again is a no-op). */
export function holdReload(reason: string): () => void {
  const key: symbol = Symbol(reason);
  holds.set(key, reason);
  return (): void => {
    if (!holds.delete(key)) return;
    if (holds.size === 0) notifyEach(listeners, 'reload-safety');
  };
}

export function reloadIsSafe(): boolean {
  return holds.size === 0;
}

/** Calls back when the last hold is released. */
export function onReloadSafe(listener: () => void): () => void {
  listeners.add(listener);
  return (): void => { listeners.delete(listener); };
}
