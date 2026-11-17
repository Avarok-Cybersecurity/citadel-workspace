/**
 * The installs whose direct-connection answers this person has open in front of them right now
 * (InstalledPeerConsent.tsx's panel). Each plane is its own write, so while the panel is open the
 * answers are still arriving: a zone that has not started its app yet waits for the panel to close
 * and starts it holding all of them (AppZone.tsx). A running app is never stopped for this. The
 * tab's own state, never a record.
 */
import { useSyncExternalStore } from 'react';
import { notifyEach } from '@/lib/notify-listeners';

let answering: ReadonlySet<string> = new Set();
const listeners: Set<() => void> = new Set();

/** Mark the panel for `installId` open or closed. */
export function markPeerAnswering(installId: string, open: boolean): void {
  const next: Set<string> = new Set(answering);
  if (open) next.add(installId); else next.delete(installId);
  answering = next;
  notifyEach(listeners, 'apps-peer-answering');
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return (): void => { listeners.delete(listener); };
}

export function usePeerAnswering(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, (): ReadonlySet<string> => answering, (): ReadonlySet<string> => answering);
}
