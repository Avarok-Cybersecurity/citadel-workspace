/**
 * Installs this person turned off for themselves. The server keeps the setting per person
 * (`SetDisabledForMe`, answered `DisabledForMe`) and says it again with every `ListInstalls`
 * (`disabled_for_me`); this is the tab's copy of the server's answer, so the Installed list and a
 * page's app zones read the same set. Nothing here is the record: a reload reads it from the
 * server again.
 */
import { useSyncExternalStore } from 'react';
import { notifyEach } from '@/lib/notify-listeners';

let disabled: ReadonlySet<string> = new Set();
const listeners: Set<() => void> = new Set();

function publish(next: ReadonlySet<string>): void {
  disabled = next;
  notifyEach(listeners, 'apps-disabled-for-me');
}

/** Record the server's answer for one install. */
export function recordDisabledForMe(installId: string, isDisabled: boolean): void {
  const next: Set<string> = new Set(disabled);
  if (isDisabled) next.add(installId); else next.delete(installId);
  publish(next);
}

/** The server's whole list for this person (a `ListInstalls` answer): it replaces the tab's copy. */
export function adoptDisabledForMe(installIds: readonly string[]): void {
  publish(new Set(installIds));
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return (): void => { listeners.delete(listener); };
}

export function useDisabledForMe(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, (): ReadonlySet<string> => disabled, (): ReadonlySet<string> => disabled);
}
