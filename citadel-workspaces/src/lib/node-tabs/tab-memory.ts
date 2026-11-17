/**
 * Which tab a node's pane was left on, for this viewer, for this browser session.
 *
 * `BaseOffice` is keyed on the node id so that it remounts when the node changes, and the tabs
 * used to keep their selection in the component instance: every remount put a reader back on the
 * page, mid-conversation, with nothing on screen to explain it. So the choice is remembered per
 * node, outside the component.
 *
 * In `sessionStorage` under `citadel:node-tab:<node id>`: a per-viewer convenience that survives
 * a reload of the tab and is never a source of truth. Every access is wrapped, because storage
 * can be absent or throw (a private window, blocked site data); without it the pane opens on its
 * page, which is what it would do anyway.
 */
import type { NodeTab, NodeTabKey } from './tab-list';

const PREFIX: string = 'citadel:node-tab:';

function storage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function rememberTab(nodeId: string, tab: NodeTabKey): void {
  try {
    storage()?.setItem(PREFIX + nodeId, tab);
  } catch {
    // Full or blocked: the next visit opens on the page instead. Nothing is lost.
  }
}

export function rememberedTab(nodeId: string): string | null {
  try {
    return storage()?.getItem(PREFIX + nodeId) ?? null;
  } catch {
    return null;
  }
}

/** Forget every node's remembered tab (sign-out, and tests). */
export function forgetAllTabs(): void {
  try {
    const store: Storage | null = storage();
    if (!store) return;
    const keys: string[] = Array.from({ length: store.length }, (_v: unknown, i: number): string | null => store.key(i))
      .filter((key: string | null): key is string => key !== null && key.startsWith(PREFIX));
    keys.forEach((key: string): void => store.removeItem(key));
  } catch {
    // Nothing to forget if storage cannot be read.
  }
}

/**
 * The tab to open: the first of `wanted` (a deep link, then the remembered tab) that is still one
 * of `tabs`, else the page. A remembered app tab that was removed since is not reopened.
 */
export function chooseOpenTab(tabs: readonly NodeTab[], wanted: readonly (string | null)[]): NodeTabKey {
  const found: NodeTab | undefined = wanted
    .map((key: string | null): NodeTab | undefined => tabs.find((tab: NodeTab): boolean => tab.key === key))
    .find((tab: NodeTab | undefined): tab is NodeTab => tab !== undefined);
  return found?.key ?? 'content';
}

/** The `tab` a deep link to this node names (`/workspace?nodeId=<id>&tab=<key>`), if any. */
export function deepLinkedTab(nodeId: string): string | null {
  try {
    const params: URLSearchParams = new URLSearchParams(window.location.search);
    return params.get('nodeId') === nodeId ? params.get('tab') : null;
  } catch {
    return null;
  }
}
