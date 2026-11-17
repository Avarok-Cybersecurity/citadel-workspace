/**
 * Who asked the marketplace to open, and on what: the account menu (browse), an app link (a
 * listing, maybe a page), a document's app zone (the same link), or a node's "+" (the apps that
 * can be a tab there, listing-for-tab.ts). One subscription, read by the
 * host on /workspace (components/citadel-apps/marketplace/AppsModalHost.tsx), so opening it from
 * anywhere costs no marketplace code until it is opened.
 */
import { useSyncExternalStore } from 'react';
import type { AppLink } from './app-link';
import { notifyEach } from '@/lib/notify-listeners';

/** The node a tab is being added to, and how: the node pane's own write (use-node-tabs.ts). */
export interface TabTarget {
  nodeId: string;
  /** The node's app tabs now: an app already among them is not offered. */
  tabs: readonly string[];
  /** Appends `appId` to the node's tabs; false when it was not (the refusal is already shown). */
  add: (appId: string) => Promise<boolean>;
}

export type AppsModalRequest = { kind: 'browse' } | { kind: 'link'; link: AppLink } | { kind: 'tab'; target: TabTarget };

let current: AppsModalRequest | null = null;
const listeners: Set<() => void> = new Set();

function set(next: AppsModalRequest | null): void {
  current = next;
  notifyEach(listeners, 'apps-modal');
}

export const openAppsModal = (request: AppsModalRequest): void => set(request);
export const closeAppsModal = (): void => set(null);

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return (): void => { listeners.delete(listener); };
}

export function useAppsModalRequest(): AppsModalRequest | null {
  return useSyncExternalStore(subscribe, (): AppsModalRequest | null => current, (): AppsModalRequest | null => null);
}
