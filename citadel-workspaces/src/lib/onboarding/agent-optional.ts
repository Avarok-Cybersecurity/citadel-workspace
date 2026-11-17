/**
 * Pages that work without the local agent, and say so while they are mounted.
 *
 * The connection-retry dialog is right almost everywhere: nearly every screen
 * is useless without the agent, and that dialog is the one that carries the
 * download links. Creating a hosted workspace is the exception. It talks only
 * to the control plane over HTTPS, and the person doing it is, by definition,
 * someone who has probably not installed the agent yet -- on the hosted site
 * that is the first-run state, not an edge case. A modal telling them to
 * install something before they have even named their workspace would sit on
 * top of the one flow that does not need it; the claim screen offers the
 * download at the point it becomes necessary.
 *
 * WorkspaceApp sits above the router, so it cannot read the route. Instead the
 * page declares itself, and the dialog asks. A count rather than a flag, so two
 * such components mounted at once cannot un-declare each other.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { notifyEach } from '@/lib/notify-listeners';

let holders: number = 0;
const listeners: Set<() => void> = new Set();

function notify(): void {
  notifyEach(listeners, 'agent-optional');
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return (): void => {
    listeners.delete(listener);
  };
}

function snapshot(): boolean {
  return holders === 0;
}

/** Call from a page that does not need the agent. Undone when it unmounts. */
export function useAgentOptionalHere(): void {
  useEffect(() => {
    holders += 1;
    notify();
    return (): void => {
      holders -= 1;
      notify();
    };
  }, []);
}

/** False while a page that works without the agent is on screen. */
export function useAgentRequired(): boolean {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
