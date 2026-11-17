/**
 * This window was let go of its session: another window took it over.
 *
 * The agent tells every window attached to a session its role whenever the set
 * changes (SessionRoleNotification, agent 0.8.6). `Detached` means this one no
 * longer receives the session -- someone moved it to another window -- and
 * left alone the tab would look signed in while nothing arrived. It is offered
 * the session back, the way a tab finding it held elsewhere at start is.
 */
import { getSelectedUser, type TabUserContext } from '@/lib/tab-context';
import { eventEmitter } from '@/lib/event-emitter';
import { errorLog } from '@/lib/debug-config';

/** The session `message` says this window was detached from, if it says so. */
export function detachedFrom(message: unknown): bigint | null {
  const m: Record<string, unknown> = (message ?? {}) as Record<string, unknown>;
  const n: unknown = (m.Response as Record<string, unknown> | undefined)?.SessionRoleNotification ?? m.SessionRoleNotification;
  if (typeof n !== 'object' || n === null) return null;
  const role: { cid?: unknown; role?: unknown } = n as { cid?: unknown; role?: unknown };
  return role.role === 'Detached' && typeof role.cid === 'bigint' ? role.cid : null;
}

/** Call `offer` with this tab's username whenever its own session is detached; answers the unsubscribe. */
export function onThisTabDetached(offer: (username: string) => void): () => void {
  const handler = (message: unknown): void => {
    const cid: bigint | null = detachedFrom(message);
    if (cid === null) return;
    getSelectedUser().then((tab: TabUserContext | null) => {
      if (tab?.selectedCid === cid && tab.selectedUsername) offer(tab.selectedUsername);
    }, (error: unknown) => errorLog('Sessions', 'this window was detached, and its account could not be read to offer it back', error));
  };
  return eventEmitter.on('websocket-message', handler);
}
