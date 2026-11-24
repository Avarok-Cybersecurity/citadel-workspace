/**
 * The icons of installed apps this tab has read a listing for, by app id: what the tree draws for
 * a node bound to an installed app's page (node-icon.ts), as a document node draws its app's. The
 * listing is the record (zone-data.ts reads it for every page); this is the tab's copy of the icon
 * it carried, so the tree does not ask the server for one per row. Until one is known, null.
 */
import { useSyncExternalStore } from 'react';
import type { AppIcon } from 'citadel-workspace-client-ts';
import { notifyEach } from '@/lib/notify-listeners';

let icons: ReadonlyMap<string, AppIcon> = new Map();
const listeners: Set<() => void> = new Set();

/** The icon a listing of `appId` carried; a later listing replaces it. */
export function recordAppIcon(appId: string, icon: AppIcon): void {
  if (icons.get(appId) === icon) return;
  icons = new Map(icons).set(appId, icon);
  notifyEach(listeners, 'installed-app-icons');
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return (): void => { listeners.delete(listener); };
}

export function useAppIcon(appId: string): AppIcon | null {
  const read = (): AppIcon | null => icons.get(appId) ?? null;
  return useSyncExternalStore(subscribe, read, read);
}
