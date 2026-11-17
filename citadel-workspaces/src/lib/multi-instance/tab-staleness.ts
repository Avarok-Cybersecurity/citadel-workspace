/**
 * Whether this tab runs a build that another build has superseded, and what it may still do.
 *
 * - STALE: a newer build is deployed (the `/version.json` poll), or another open tab runs a
 *   newer build of a protocol this one speaks. A stale tab never becomes leader and never
 *   opens a socket (initialization.ts refuses), so it never claims sessions either; it sends
 *   its requests through the leader like any follower, and shows the reload banner.
 * - INERT: another tab's protocol is too new for this one to serve or be served by. An inert
 *   tab does not lead and does not send requests at all: it is read-only until reloaded.
 *
 * Neither ever clears: only a reload replaces the build that is running.
 */
import { createValueStore, type ValueStore } from '@/lib/value-store';
import { debugLog } from '@/lib/debug-config';

export type StaleCause = 'deployed' | 'newer-tab';

export interface TabStaleness {
  readonly stale: boolean;
  readonly inert: boolean;
  readonly cause: StaleCause | null;
}

const store: ValueStore<TabStaleness> = createValueStore<TabStaleness>('tab-staleness', {
  stale: false, inert: false, cause: null,
});

/** Open tabs known to run a newer compatible build, by instance id. */
const newerTabs: Set<string> = new Set<string>();
const newerTabListeners: Set<() => void> = new Set<() => void>();

export function markStale(cause: StaleCause): void {
  const now: TabStaleness = store.get();
  if (now.stale) return;
  debugLog('TabStaleness', `This tab's build is superseded (${cause})`);
  store.set({ ...now, stale: true, cause });
}

export function markInert(): void {
  const now: TabStaleness = store.get();
  if (now.inert) return;
  debugLog('TabStaleness', 'Another tab speaks a protocol this build cannot serve: read-only');
  store.set({ ...now, inert: true });
}

/** Another open tab runs a newer compatible build. */
export function noteNewerTab(instanceId: string): void {
  markStale('newer-tab');
  if (newerTabs.has(instanceId)) return;
  newerTabs.add(instanceId);
  for (const listener of [...newerTabListeners]) listener();
}

/** That tab has gone (goodbye). */
export function forgetTab(instanceId: string): void {
  newerTabs.delete(instanceId);
}

export function newerTabIsOpen(): boolean {
  return newerTabs.size > 0;
}

/** Calls back each time a newer tab is first heard; see the leader's handover. */
export function onNewerTab(listener: () => void): () => void {
  newerTabListeners.add(listener);
  return (): void => { newerTabListeners.delete(listener); };
}

/** True when this tab must not take leadership or open a socket. */
export function refusesToLead(): boolean {
  const now: TabStaleness = store.get();
  return now.stale || now.inert;
}

/**
 * Throws, giving leadership up first, when this tab must not open the browser's socket.
 * Giving it up is what stops the leader's reconnect timer from asking again at once.
 */
export function assertMayOpenSocket(relinquish: () => void): void {
  if (!refusesToLead()) return;
  relinquish();
  throw new Error('This tab runs a superseded build, so it does not open a connection to the agent. Reload it.');
}

export function isInert(): boolean {
  return store.get().inert;
}

export const getTabStaleness: () => TabStaleness = store.get;
export const subscribeTabStaleness: (listener: () => void) => () => void = store.subscribe;
